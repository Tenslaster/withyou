/**
 * WithYou — private couple presence (Love8-style, richer live status)
 * Mutual location · battery · distance · last seen · mood
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import * as Battery from 'expo-battery';
import * as SecureStore from 'expo-secure-store';
import * as Device from 'expo-device';
import * as Network from 'expo-network';
import Constants from 'expo-constants';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';

// --- Config -----------------------------------------------------------------
const DEFAULT_API =
  (Constants.expoConfig?.extra?.apiUrl || 'https://crew.kingdom.forum/withyou').replace(
    /\/+$/,
    ''
  );
const API_URL = (process.env.EXPO_PUBLIC_WITHYOU_API || DEFAULT_API).replace(/\/+$/, '');
const TOKEN_KEY = 'withyou_token_v1';
const NAME_KEY = 'withyou_name_v1';
const APP_VERSION = Constants.expoConfig?.version || '1.0.0';
const POLL_MS = 12000;
const HEARTBEAT_MS = 20000;

// --- helpers ----------------------------------------------------------------
async function api(path, { method = 'GET', token, body } = {}) {
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': `WithYou/${APP_VERSION} (${Platform.OS})`,
    'X-App-Version': APP_VERSION,
  };
  if (token) headers.Authorization = token;
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text || res.statusText };
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function fmtDist(m) {
  if (m == null || Number.isNaN(m)) return '—';
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
}

function fmtAgo(ts) {
  if (!ts) return 'never';
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (s < 15) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function batteryColor(pct, charging) {
  if (charging) return '#34d399';
  if (pct == null) return '#94a3b8';
  if (pct <= 15) return '#f87171';
  if (pct <= 30) return '#fbbf24';
  return '#38bdf8';
}

// --- App --------------------------------------------------------------------
export default function App() {
  const [boot, setBoot] = useState(true);
  const [token, setToken] = useState(null);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('💙');
  const [inviteInput, setInviteInput] = useState('');
  const [createdInvite, setCreatedInvite] = useState('');
  const [pair, setPair] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [mood, setMood] = useState('');
  const [statusText, setStatusText] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const mapRef = useRef(null);
  const tokenRef = useRef(null);
  tokenRef.current = token;

  const partner = pair?.partner;
  const me = pair?.me;

  // Boot session
  useEffect(() => {
    (async () => {
      try {
        const [t, n] = await Promise.all([
          SecureStore.getItemAsync(TOKEN_KEY),
          SecureStore.getItemAsync(NAME_KEY),
        ]);
        if (n) setName(n);
        if (t) {
          setToken(t);
          try {
            const data = await api('/me', { token: t });
            setPair(data);
            if (data?.me?.mood) setMood(data.me.mood);
            if (data?.me?.status_text) setStatusText(data.me.status_text);
          } catch {
            await SecureStore.deleteItemAsync(TOKEN_KEY);
            setToken(null);
          }
        }
      } finally {
        setBoot(false);
      }
    })();
  }, []);

  const collectTelemetry = useCallback(async () => {
    const body = {
      platform: Platform.OS,
      app_version: APP_VERSION,
      mood: mood || undefined,
      status_text: statusText || undefined,
    };
    try {
      const level = await Battery.getBatteryLevelAsync();
      if (level >= 0) body.battery = Math.round(level * 100);
      const state = await Battery.getBatteryStateAsync();
      body.charging =
        state === Battery.BatteryState.CHARGING ||
        state === Battery.BatteryState.FULL;
      try {
        body.low_power = await Battery.isLowPowerModeEnabledAsync();
      } catch {
        /* optional */
      }
    } catch {
      /* battery optional in simulator */
    }
    try {
      const net = await Network.getNetworkStateAsync();
      body.network = net.type || (net.isConnected ? 'online' : 'offline');
    } catch {
      /* ignore */
    }
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        body.lat = loc.coords.latitude;
        body.lng = loc.coords.longitude;
        body.accuracy_m = loc.coords.accuracy;
        if (loc.coords.speed != null && loc.coords.speed >= 0) {
          body.speed_mps = loc.coords.speed;
        }
        if (loc.coords.heading != null && loc.coords.heading >= 0) {
          body.heading = loc.coords.heading;
        }
        if (loc.coords.altitude != null) body.altitude_m = loc.coords.altitude;
      }
    } catch {
      /* location denied */
    }
    return body;
  }, [mood, statusText]);

  const heartbeat = useCallback(async () => {
    const t = tokenRef.current;
    if (!t) return;
    try {
      const body = await collectTelemetry();
      const data = await api('/heartbeat', { method: 'POST', token: t, body });
      if (data?.ok) setPair(data);
      setErr('');
    } catch (e) {
      setErr(e.message || 'Sync failed');
    }
  }, [collectTelemetry]);

  const refresh = useCallback(async () => {
    const t = tokenRef.current;
    if (!t) return;
    setRefreshing(true);
    try {
      const data = await api('/me', { token: t });
      setPair(data);
      setErr('');
    } catch (e) {
      setErr(e.message || 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Permissions + loops
  useEffect(() => {
    if (!token) return undefined;
    let alive = true;
    (async () => {
      try {
        const fg = await Location.requestForegroundPermissionsAsync();
        if (fg.status === 'granted') {
          // Best-effort background (works better on standalone APK/IPA)
          try {
            await Location.requestBackgroundPermissionsAsync();
          } catch {
            /* Expo Go may limit this */
          }
        }
      } catch {
        /* ignore */
      }
      if (alive) heartbeat();
    })();
    const h = setInterval(() => {
      if (AppState.currentState === 'active') heartbeat();
    }, HEARTBEAT_MS);
    const p = setInterval(() => {
      if (AppState.currentState === 'active') refresh();
    }, POLL_MS);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') heartbeat();
    });
    return () => {
      alive = false;
      clearInterval(h);
      clearInterval(p);
      sub.remove();
    };
  }, [token, heartbeat, refresh]);

  const createPair = async () => {
    if (!name.trim()) {
      Alert.alert('Name', 'Enter your name first.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const data = await api('/pair/create', {
        method: 'POST',
        body: {
          display_name: name.trim(),
          emoji,
          platform: Platform.OS,
        },
      });
      await SecureStore.setItemAsync(TOKEN_KEY, data.token);
      await SecureStore.setItemAsync(NAME_KEY, name.trim());
      setToken(data.token);
      setCreatedInvite(data.invite_code || '');
      setPair({
        me: data.me,
        partner: data.partner,
        invite_code: data.invite_code,
        days_together: data.days_together ?? 0,
        distance_m: null,
        partner_joined: false,
      });
    } catch (e) {
      setErr(e.message || 'Create failed');
    } finally {
      setBusy(false);
    }
  };

  const joinPair = async () => {
    if (!name.trim() || !inviteInput.trim()) {
      Alert.alert('Join', 'Name + invite code required.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const data = await api('/pair/join', {
        method: 'POST',
        body: {
          invite_code: inviteInput.trim(),
          display_name: name.trim(),
          emoji,
          platform: Platform.OS,
        },
      });
      await SecureStore.setItemAsync(TOKEN_KEY, data.token);
      await SecureStore.setItemAsync(NAME_KEY, name.trim());
      setToken(data.token);
      setPair(data);
    } catch (e) {
      setErr(e.message || 'Join failed');
    } finally {
      setBusy(false);
    }
  };

  const leavePair = () => {
    Alert.alert('Leave pair?', 'You will stop sharing with your partner.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: async () => {
          try {
            if (token) await api('/pair/leave', { method: 'POST', token, body: {} });
          } catch {
            /* ignore */
          }
          await SecureStore.deleteItemAsync(TOKEN_KEY);
          setToken(null);
          setPair(null);
          setCreatedInvite('');
        },
      },
    ]);
  };

  const region = useMemo(() => {
    const pts = [];
    if (me?.lat != null && me?.lng != null) pts.push({ lat: me.lat, lng: me.lng });
    if (partner?.lat != null && partner?.lng != null) {
      pts.push({ lat: partner.lat, lng: partner.lng });
    }
    if (!pts.length) {
      return { latitude: 48.8566, longitude: 2.3522, latitudeDelta: 0.08, longitudeDelta: 0.08 };
    }
    if (pts.length === 1) {
      return {
        latitude: pts[0].lat,
        longitude: pts[0].lng,
        latitudeDelta: 0.04,
        longitudeDelta: 0.04,
      };
    }
    const lats = pts.map((p) => p.lat);
    const lngs = pts.map((p) => p.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: Math.max(0.02, (maxLat - minLat) * 2.2),
      longitudeDelta: Math.max(0.02, (maxLng - minLng) * 2.2),
    };
  }, [me?.lat, me?.lng, partner?.lat, partner?.lng]);

  if (boot) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator color="#f472b6" size="large" />
        <Text style={styles.bootText}>WithYou</Text>
        <StatusBar style="light" />
      </View>
    );
  }

  // --- Pairing screen ---
  if (!token) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar style="light" />
        <ScrollView contentContainerStyle={styles.pad}>
          <Text style={styles.logo}>WithYou</Text>
          <Text style={styles.tagline}>
            Private couple radar — location, battery, distance & last seen.
            Only the two of you.
          </Text>
          <Text style={styles.label}>Your name</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Alex"
            placeholderTextColor="#64748b"
            value={name}
            onChangeText={setName}
          />
          <Text style={styles.label}>Emoji</Text>
          <TextInput
            style={styles.input}
            value={emoji}
            onChangeText={setEmoji}
            maxLength={4}
          />
          <Pressable style={[styles.btn, styles.btnPrimary]} onPress={createPair} disabled={busy}>
            {busy ? (
              <ActivityIndicator color="#0f0a12" />
            ) : (
              <Text style={styles.btnPrimaryText}>Create pair (get invite code)</Text>
            )}
          </Pressable>
          <View style={styles.divider}>
            <Text style={styles.dividerText}>or join partner</Text>
          </View>
          <Text style={styles.label}>Invite code</Text>
          <TextInput
            style={styles.input}
            placeholder="6-character code"
            placeholderTextColor="#64748b"
            autoCapitalize="characters"
            value={inviteInput}
            onChangeText={setInviteInput}
          />
          <Pressable style={[styles.btn, styles.btnGhost]} onPress={joinPair} disabled={busy}>
            <Text style={styles.btnGhostText}>Join pair</Text>
          </Pressable>
          {!!err && <Text style={styles.error}>{err}</Text>}
          <Text style={styles.hint}>
            API: {API_URL}
            {'\n'}
            Data stays on your server. Mutual consent only.
          </Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // --- Main ---
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={styles.padBottom}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor="#f472b6" />
        }
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.logoSm}>WithYou</Text>
            <Text style={styles.days}>
              {pair?.days_together != null ? `${pair.days_together} days together` : '—'}
              {createdInvite || pair?.invite_code
                ? ` · code ${createdInvite || pair?.invite_code}`
                : ''}
            </Text>
          </View>
          <Pressable onPress={leavePair} hitSlop={10}>
            <Text style={styles.leave}>Leave</Text>
          </Pressable>
        </View>

        {!pair?.partner_joined && !partner ? (
          <View style={styles.banner}>
            <Text style={styles.bannerTitle}>Waiting for partner</Text>
            <Text style={styles.bannerBody}>
              Share invite code{' '}
              <Text style={styles.code}>{createdInvite || pair?.invite_code || '—'}</Text> so they
              can join. Only 2 devices.
            </Text>
          </View>
        ) : null}

        {/* Map */}
        <View style={styles.mapWrap}>
          <MapView
            ref={mapRef}
            style={styles.map}
            provider={PROVIDER_DEFAULT}
            initialRegion={region}
            region={region}
            userInterfaceStyle="dark"
          >
            {me?.lat != null && me?.lng != null ? (
              <Marker
                coordinate={{ latitude: me.lat, longitude: me.lng }}
                title={me.display_name || 'You'}
                description="You"
                pinColor="#38bdf8"
              />
            ) : null}
            {partner?.lat != null && partner?.lng != null ? (
              <Marker
                coordinate={{ latitude: partner.lat, longitude: partner.lng }}
                title={partner.display_name || 'Partner'}
                description={partner.online ? 'Online' : fmtAgo(partner.last_seen)}
                pinColor="#f472b6"
              />
            ) : null}
          </MapView>
        </View>

        {/* Distance strip */}
        <View style={styles.distRow}>
          <Text style={styles.distValue}>{fmtDist(pair?.distance_m)}</Text>
          <Text style={styles.distLabel}>apart</Text>
          {!!err && <Text style={styles.errorInline}>{err}</Text>}
        </View>

        {/* Partner card */}
        <PersonCard
          title="Partner"
          person={partner}
          emptyHint="Not joined yet"
        />
        <PersonCard title="You" person={me} emptyHint="Share location to appear" />

        {/* Mood / status */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Your status</Text>
          <TextInput
            style={styles.input}
            placeholder="Mood (happy, tired…)"
            placeholderTextColor="#64748b"
            value={mood}
            onChangeText={setMood}
          />
          <TextInput
            style={[styles.input, { marginTop: 8 }]}
            placeholder="Status message"
            placeholderTextColor="#64748b"
            value={statusText}
            onChangeText={setStatusText}
          />
          <Pressable style={[styles.btn, styles.btnPrimary, { marginTop: 10 }]} onPress={heartbeat}>
            <Text style={styles.btnPrimaryText}>Update now</Text>
          </Pressable>
        </View>

        <Text style={styles.footer}>
          Device {Device.modelName || Platform.OS} · v{APP_VERSION}
          {'\n'}
          Background location works best on installed APK/IPA (not only Expo Go).
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function PersonCard({ title, person, emptyHint }) {
  if (!person) {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.muted}>{emptyHint}</Text>
      </View>
    );
  }
  const pct = person.battery;
  const bc = batteryColor(pct, person.charging);
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={styles.cardTitle}>
          {person.emoji || '💕'} {person.display_name || title}
        </Text>
        <View style={[styles.dot, { backgroundColor: person.online ? '#34d399' : '#64748b' }]} />
      </View>
      <Text style={styles.meta}>
        {person.online ? 'Online' : 'Offline'} · last seen {fmtAgo(person.last_seen)}
      </Text>
      <View style={styles.row}>
        <Text style={[styles.batt, { color: bc }]}>
          🔋 {pct != null ? `${Math.round(pct)}%` : '—'}
          {person.charging ? ' ⚡' : ''}
          {person.low_power ? ' · Low Power' : ''}
        </Text>
      </View>
      {!!person.mood || !!person.status_text ? (
        <Text style={styles.statusLine}>
          {person.mood ? `${person.mood}` : ''}
          {person.mood && person.status_text ? ' — ' : ''}
          {person.status_text || ''}
        </Text>
      ) : null}
      <Text style={styles.meta}>
        {person.lat != null
          ? `${Number(person.lat).toFixed(5)}, ${Number(person.lng).toFixed(5)}`
          : 'No GPS yet'}
        {person.accuracy_m != null ? ` · ±${Math.round(person.accuracy_m)}m` : ''}
      </Text>
      <Text style={styles.meta}>
        {person.platform || '—'}
        {person.network ? ` · ${person.network}` : ''}
        {person.speed_mps != null && person.speed_mps > 0.5
          ? ` · ${(person.speed_mps * 3.6).toFixed(0)} km/h`
          : ''}
        {person.app_version ? ` · v${person.app_version}` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0f0a12' },
  boot: {
    flex: 1,
    backgroundColor: '#0f0a12',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bootText: { color: '#f472b6', marginTop: 12, fontSize: 22, fontWeight: '800' },
  pad: { padding: 20, paddingTop: 36 },
  padBottom: { paddingBottom: 40 },
  logo: {
    color: '#f472b6',
    fontSize: 36,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  logoSm: { color: '#f472b6', fontSize: 22, fontWeight: '900' },
  tagline: { color: '#94a3b8', marginTop: 10, marginBottom: 24, lineHeight: 20 },
  label: { color: '#cbd5e1', fontSize: 13, fontWeight: '600', marginBottom: 6 },
  input: {
    backgroundColor: '#1a1220',
    borderWidth: 1,
    borderColor: '#2d2438',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#f8fafc',
    marginBottom: 12,
  },
  btn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnPrimary: { backgroundColor: '#f472b6' },
  btnPrimaryText: { color: '#0f0a12', fontWeight: '800', fontSize: 15 },
  btnGhost: {
    borderWidth: 1,
    borderColor: '#f472b6',
    backgroundColor: 'transparent',
  },
  btnGhostText: { color: '#f472b6', fontWeight: '700' },
  divider: { alignItems: 'center', marginVertical: 18 },
  dividerText: { color: '#64748b', fontSize: 12 },
  error: { color: '#f87171', marginTop: 12 },
  errorInline: { color: '#f87171', fontSize: 12, marginLeft: 8 },
  hint: { color: '#475569', fontSize: 11, marginTop: 24, lineHeight: 16 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
  },
  days: { color: '#94a3b8', fontSize: 12, marginTop: 2 },
  leave: { color: '#f87171', fontWeight: '700' },
  banner: {
    marginHorizontal: 16,
    backgroundColor: '#1e1530',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#3b2d55',
    marginBottom: 10,
  },
  bannerTitle: { color: '#f8fafc', fontWeight: '800', marginBottom: 4 },
  bannerBody: { color: '#94a3b8', lineHeight: 18 },
  code: { color: '#f472b6', fontWeight: '900', letterSpacing: 1 },
  mapWrap: {
    height: 260,
    marginHorizontal: 16,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#2d2438',
  },
  map: { flex: 1 },
  distRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  distValue: { color: '#f8fafc', fontSize: 28, fontWeight: '900' },
  distLabel: { color: '#94a3b8', marginLeft: 8, fontSize: 14 },
  card: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: '#1a1220',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#2d2438',
  },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { color: '#f8fafc', fontSize: 16, fontWeight: '800' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  meta: { color: '#94a3b8', fontSize: 12, marginTop: 4 },
  batt: { fontSize: 18, fontWeight: '800', marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center' },
  statusLine: { color: '#e2e8f0', marginTop: 8, fontStyle: 'italic' },
  muted: { color: '#64748b' },
  footer: {
    color: '#475569',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 20,
    lineHeight: 16,
  },
});
