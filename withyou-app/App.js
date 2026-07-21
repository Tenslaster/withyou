/**
 * WithYou — private couple presence + deep partner intel
 * Live location · battery · motion · place · weather · care · SOS · stats
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  Share,
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
import * as Cellular from 'expo-cellular';
import * as Localization from 'expo-localization';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';

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

const ACTIVITIES = [
  { id: 'home', label: '🏠 Home' },
  { id: 'work', label: '💼 Work' },
  { id: 'gym', label: '🏋️ Gym' },
  { id: 'sleep', label: '😴 Sleep' },
  { id: 'out', label: '🚗 Out' },
  { id: 'food', label: '🍽️ Food' },
  { id: 'travel', label: '✈️ Travel' },
  { id: 'study', label: '📚 Study' },
];

const MOODS = ['😊', '🥰', '😌', '😢', '😤', '🤒', '🥱', '🥳', '😰', '😎'];

const WMO = {
  0: 'Clear',
  1: 'Mostly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Fog',
  51: 'Drizzle',
  61: 'Rain',
  63: 'Rain',
  65: 'Heavy rain',
  71: 'Snow',
  80: 'Showers',
  95: 'Thunder',
};

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/** Invite codes are 6 hex chars (A–F, 0–9). Strip junk users often paste. */
function cleanInviteCode(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/[^A-F0-9]/g, '')
    .slice(0, 8);
}

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

function fmtDuration(sec) {
  if (sec == null || Number.isNaN(sec)) return '—';
  const s = Math.max(0, Math.floor(sec));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

function batteryColor(pct, charging) {
  if (charging) return '#34d399';
  if (pct == null) return '#94a3b8';
  if (pct <= 15) return '#f87171';
  if (pct <= 30) return '#fbbf24';
  return '#38bdf8';
}

function motionLabel(m) {
  const map = {
    still: 'Still',
    walking: 'Walking',
    running_or_bike: 'Running / bike',
    driving: 'Driving',
    unknown: 'Unknown',
  };
  return map[m] || m || '—';
}

function headingCardinal(deg) {
  if (deg == null || Number.isNaN(Number(deg))) return '';
  const d = ((Number(deg) % 360) + 360) % 360;
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.floor((d + 22.5) / 45) % 8];
}

function weatherLabel(code) {
  if (code == null) return '';
  return WMO[code] || WMO[Math.floor(code / 10) * 10] || `Code ${code}`;
}

async function fetchWeather(lat, lng) {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
      `&current=temperature_2m,weather_code&timezone=auto`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const j = await res.json();
    const cur = j?.current;
    if (!cur) return null;
    return {
      weather_temp_c: cur.temperature_2m,
      weather_code: cur.weather_code,
      weather_label: weatherLabel(cur.weather_code),
    };
  } catch {
    return null;
  }
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
  const [activity, setActivity] = useState('');
  const [loveDraft, setLoveDraft] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const mapRef = useRef(null);
  const tokenRef = useRef(null);
  const weatherCache = useRef({ at: 0, data: null, key: '' });
  tokenRef.current = token;

  const partner = pair?.partner;
  const me = pair?.me;
  const stats = pair?.stats;

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
            if (data?.me?.activity) setActivity(data.me.activity);
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

  // Push notifications registration
  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const { status: existing } = await Notifications.getPermissionsAsync();
        let final = existing;
        if (existing !== 'granted') {
          const req = await Notifications.requestPermissionsAsync();
          final = req.status;
        }
        if (final !== 'granted' || cancelled) return;
        const projectId =
          Constants.expoConfig?.extra?.eas?.projectId ||
          Constants.easConfig?.projectId;
        const push = await Notifications.getExpoPushTokenAsync(
          projectId ? { projectId } : undefined
        );
        if (push?.data && !cancelled) {
          await api('/push-token', {
            method: 'POST',
            token,
            body: { push_token: push.data },
          });
        }
      } catch {
        /* optional on simulators / missing FCM */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const collectTelemetry = useCallback(async () => {
    const locales = Localization.getLocales?.() || [];
    const calendars = Localization.getCalendars?.() || [];
    const tz = calendars[0]?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    const locale = locales[0]?.languageTag || '';
    const hour = new Date().getHours();
    const body = {
      platform: Platform.OS,
      app_version: APP_VERSION,
      mood: mood || undefined,
      status_text: statusText || undefined,
      activity: activity || undefined,
      device_model: Device.modelName || Device.modelId || '',
      device_brand: Device.brand || '',
      os_name: Device.osName || Platform.OS,
      os_version: Device.osVersion || '',
      timezone: tz,
      locale,
      app_state: AppState.currentState || 'active',
      local_hour: hour,
      day_night: hour >= 6 && hour < 20 ? 'day' : 'night',
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
      /* battery optional */
    }
    try {
      const net = await Network.getNetworkStateAsync();
      body.network = net.type || (net.isConnected ? 'online' : 'offline');
      body.is_internet = !!net.isConnected && net.isInternetReachable !== false;
      body.is_wifi = String(net.type || '').toLowerCase().includes('wifi');
    } catch {
      /* ignore */
    }
    try {
      const gen = await Cellular.getCellularGenerationAsync();
      const map = {
        [Cellular.CellularGeneration.CELLULAR_2G]: '2G',
        [Cellular.CellularGeneration.CELLULAR_3G]: '3G',
        [Cellular.CellularGeneration.CELLULAR_4G]: '4G',
        [Cellular.CellularGeneration.CELLULAR_5G]: '5G',
      };
      body.cellular_gen = map[gen] || '';
      body.carrier = (await Cellular.getCarrierNameAsync()) || '';
    } catch {
      /* optional */
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
          if (loc.coords.speed < 0.4) body.motion = 'still';
          else if (loc.coords.speed < 2) body.motion = 'walking';
          else if (loc.coords.speed < 8) body.motion = 'running_or_bike';
          else body.motion = 'driving';
        }
        if (loc.coords.heading != null && loc.coords.heading >= 0) {
          body.heading = loc.coords.heading;
          body.heading_cardinal = headingCardinal(loc.coords.heading);
        }
        if (loc.coords.altitude != null) body.altitude_m = loc.coords.altitude;

        // reverse geocode
        try {
          const places = await Location.reverseGeocodeAsync({
            latitude: body.lat,
            longitude: body.lng,
          });
          const p = places?.[0];
          if (p) {
            body.place_name =
              p.name || p.street || p.district || p.city || p.subregion || '';
            body.place_city = p.city || p.subregion || '';
            body.place_region = p.region || '';
            body.place_country = p.country || '';
          }
        } catch {
          /* geocode optional */
        }

        // weather (cached ~10 min)
        const wkey = `${body.lat.toFixed(2)},${body.lng.toFixed(2)}`;
        const now = Date.now();
        if (
          weatherCache.current.key === wkey &&
          now - weatherCache.current.at < 10 * 60 * 1000 &&
          weatherCache.current.data
        ) {
          Object.assign(body, weatherCache.current.data);
        } else {
          const w = await fetchWeather(body.lat, body.lng);
          if (w) {
            weatherCache.current = { at: now, data: w, key: wkey };
            Object.assign(body, w);
          }
        }
      }
    } catch {
      /* location denied */
    }
    return body;
  }, [mood, statusText, activity]);

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
          try {
            await Location.requestBackgroundPermissionsAsync();
          } catch {
            /* Expo Go may limit */
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
    const n = (name || '').trim() || 'Me';
    if (!(name || '').trim()) setName(n);
    setBusy(true);
    setErr('');
    try {
      const data = await api('/pair/create', {
        method: 'POST',
        body: {
          display_name: n,
          emoji: emoji || '💙',
          platform: Platform.OS,
        },
      });
      if (!data?.token || !data?.invite_code) {
        throw new Error('Server did not return an invite code. Is the API online?');
      }
      await SecureStore.setItemAsync(TOKEN_KEY, data.token);
      await SecureStore.setItemAsync(NAME_KEY, n);
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
      const code = data.invite_code;
      Alert.alert(
        'Invite code ready',
        `Your code is ${code}\n\nShare it with your partner. They only need this code to Join pair.`,
        [
          { text: 'OK' },
          {
            text: 'Share code',
            onPress: () => {
              Share.share({
                message: `Join me on WithYou! Invite code: ${code}`,
              }).catch(() => {});
            },
          },
        ]
      );
    } catch (e) {
      setErr(e.message || 'Create failed');
    } finally {
      setBusy(false);
    }
  };

  const joinPair = async () => {
    const n = (name || '').trim() || 'Partner';
    const code = cleanInviteCode(inviteInput);
    if (!code || code.length < 4) {
      Alert.alert(
        'Invite code',
        'Type the 6-character code your partner got after Create pair (letters A–F and digits).'
      );
      return;
    }
    if (!(name || '').trim()) setName(n);
    setInviteInput(code);
    setBusy(true);
    setErr('');
    try {
      const data = await api('/pair/join', {
        method: 'POST',
        body: {
          invite_code: code,
          display_name: n,
          emoji: emoji || '💗',
          platform: Platform.OS,
        },
      });
      if (!data?.token) {
        throw new Error('Join failed — no session from server');
      }
      await SecureStore.setItemAsync(TOKEN_KEY, data.token);
      await SecureStore.setItemAsync(NAME_KEY, n);
      setToken(data.token);
      setPair(data);
    } catch (e) {
      const msg = e.message || 'Join failed';
      if (e.status === 404) {
        setErr('Invite not found. Check the code, or create a new pair.');
      } else if (e.status === 409) {
        setErr('This pair is already full (2 phones max). Create a new pair.');
      } else {
        setErr(msg);
      }
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
            /* still clear local */
          }
          await SecureStore.deleteItemAsync(TOKEN_KEY);
          setToken(null);
          setPair(null);
          setCreatedInvite('');
        },
      },
    ]);
  };

  const sendLoveNote = async () => {
    const note = (loveDraft || '').trim();
    if (!note) {
      Alert.alert('Love note', 'Type a short message first.');
      return;
    }
    try {
      const data = await api('/care/note', {
        method: 'POST',
        token,
        body: { note },
      });
      setPair(data);
      setLoveDraft('');
      Alert.alert('Sent 💕', 'Your partner will see this note.');
    } catch (e) {
      Alert.alert('Failed', e.message || 'Could not send');
    }
  };

  const sendPing = async () => {
    try {
      const data = await api('/care/ping', { method: 'POST', token, body: {} });
      setPair(data);
      Alert.alert('Sent 💗', 'Thinking of you — partner notified.');
    } catch (e) {
      Alert.alert('Failed', e.message || 'Could not ping');
    }
  };

  const toggleSos = async () => {
    const active = !me?.sos_active;
    if (active) {
      Alert.alert('Send SOS?', 'Partner gets an urgent alert.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send SOS',
          style: 'destructive',
          onPress: async () => {
            try {
              const data = await api('/care/sos', {
                method: 'POST',
                token,
                body: { active: true, message: 'I need you — please check on me' },
              });
              setPair(data);
            } catch (e) {
              Alert.alert('Failed', e.message);
            }
          },
        },
      ]);
    } else {
      try {
        const data = await api('/care/sos', {
          method: 'POST',
          token,
          body: { active: false },
        });
        setPair(data);
      } catch (e) {
        Alert.alert('Failed', e.message);
      }
    }
  };

  const setHomeHere = async () => {
    try {
      const data = await api('/home', {
        method: 'POST',
        token,
        body: { lat: me?.lat, lng: me?.lng },
      });
      setPair(data);
      Alert.alert('Home saved', 'Partner can see when you are at home.');
      heartbeat();
    } catch (e) {
      Alert.alert('Failed', e.message || 'Need GPS first');
    }
  };

  const pickActivity = async (id) => {
    setActivity(id);
    try {
      const data = await api('/care/activity', {
        method: 'POST',
        token,
        body: { activity: id },
      });
      setPair(data);
      heartbeat();
    } catch {
      /* heartbeat will sync */
    }
  };

  const region = useMemo(() => {
    const pts = [];
    if (me?.lat != null && me?.lng != null) pts.push({ latitude: me.lat, longitude: me.lng });
    if (partner?.lat != null && partner?.lng != null) {
      pts.push({ latitude: partner.lat, longitude: partner.lng });
    }
    if (!pts.length) {
      return {
        latitude: 45.5,
        longitude: -73.6,
        latitudeDelta: 0.08,
        longitudeDelta: 0.08,
      };
    }
    if (pts.length === 1) {
      return {
        latitude: pts[0].latitude,
        longitude: pts[0].longitude,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      };
    }
    const lats = pts.map((p) => p.latitude);
    const lngs = pts.map((p) => p.longitude);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: Math.max(0.02, (maxLat - minLat) * 1.8),
      longitudeDelta: Math.max(0.02, (maxLng - minLng) * 1.8),
    };
  }, [me?.lat, me?.lng, partner?.lat, partner?.lng]);

  const trailCoords = useMemo(() => {
    const t = pair?.partner_trail || [];
    return t
      .filter((h) => h.lat != null && h.lng != null)
      .map((h) => ({ latitude: h.lat, longitude: h.lng }));
  }, [pair?.partner_trail]);

  if (boot) {
    return (
      <SafeAreaView style={styles.boot}>
        <StatusBar style="light" />
        <ActivityIndicator size="large" color="#f472b6" />
        <Text style={styles.bootText}>WithYou</Text>
      </SafeAreaView>
    );
  }

  // --- Pairing screen ---
  if (!token) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar style="light" />
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.pad}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.logo}>WithYou</Text>
            <Text style={styles.tagline}>
              One of you creates a pair and gets a code. The other only needs
              that code to join — then you see live partner intel.
            </Text>
            <Text style={styles.label}>Invite code (to join)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 30A070"
              placeholderTextColor="#64748b"
              autoCapitalize="characters"
              autoCorrect={false}
              autoComplete="off"
              textContentType="oneTimeCode"
              value={inviteInput}
              onChangeText={(t) => setInviteInput(cleanInviteCode(t))}
              maxLength={8}
            />
            <Pressable style={[styles.btn, styles.btnGhost]} onPress={joinPair} disabled={busy}>
              {busy ? (
                <ActivityIndicator color="#f472b6" />
              ) : (
                <Text style={styles.btnGhostText}>Join pair</Text>
              )}
            </Pressable>
            <View style={styles.divider}>
              <Text style={styles.dividerText}>or create a new pair</Text>
            </View>
            <Text style={styles.label}>Your name (optional)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Alex"
              placeholderTextColor="#64748b"
              value={name}
              onChangeText={setName}
              autoCorrect={false}
              returnKeyType="done"
            />
            <Text style={styles.label}>Emoji (optional)</Text>
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
                <Text style={styles.btnPrimaryText}>Create pair → get code</Text>
              )}
            </Pressable>
            {!!err && <Text style={styles.error}>{err}</Text>}
            <Text style={styles.hint}>
              How to pair:{'\n'}
              • Phone A: Create pair → share the 6-char code{'\n'}
              • Phone B: paste code → Join pair{'\n'}
              {'\n'}
              API: {API_URL}
            </Text>
          </ScrollView>
        </KeyboardAvoidingView>
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

        {partner?.sos_active ? (
          <View style={[styles.banner, styles.sosBanner]}>
            <Text style={styles.bannerTitle}>🚨 PARTNER SOS</Text>
            <Text style={styles.bannerBody}>
              {partner.sos_message || 'Needs you'} · {fmtAgo(partner.sos_at)}
            </Text>
          </View>
        ) : null}

        {me?.love_note ? (
          <View style={styles.banner}>
            <Text style={styles.bannerTitle}>
              💕 Note from {me.love_note_from || 'partner'}
            </Text>
            <Text style={styles.bannerBody}>{me.love_note}</Text>
            <Text style={styles.meta}>{fmtAgo(me.love_note_at)}</Text>
          </View>
        ) : null}

        {me?.thinking_of_you_at ? (
          <View style={[styles.banner, { borderColor: '#f472b6' }]}>
            <Text style={styles.bannerTitle}>💗 Thinking of you</Text>
            <Text style={styles.bannerBody}>
              Partner pinged you {fmtAgo(me.thinking_of_you_at)}
            </Text>
          </View>
        ) : null}

        {!pair?.partner_joined && !partner ? (
          <View style={styles.banner}>
            <Text style={styles.bannerTitle}>Waiting for partner</Text>
            <Text style={styles.bannerBody}>
              Share this code. They only need the code to Join.
            </Text>
            <Text style={[styles.code, { fontSize: 28, marginTop: 10, textAlign: 'center' }]}>
              {createdInvite || pair?.invite_code || '—'}
            </Text>
            <Pressable
              style={[styles.btn, styles.btnPrimary, { marginTop: 12 }]}
              onPress={() => {
                const code = createdInvite || pair?.invite_code || '';
                if (!code) return;
                Share.share({ message: `Join me on WithYou! Invite code: ${code}` }).catch(
                  () => {}
                );
              }}
            >
              <Text style={styles.btnPrimaryText}>Share invite code</Text>
            </Pressable>
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
            {trailCoords.length > 1 ? (
              <Polyline coordinates={trailCoords} strokeColor="#f472b688" strokeWidth={3} />
            ) : null}
            {me?.lat != null && me?.lng != null ? (
              <Marker
                coordinate={{ latitude: me.lat, longitude: me.lng }}
                title={me.display_name || 'You'}
                description={me.place_name || 'You'}
                pinColor="#38bdf8"
              />
            ) : null}
            {partner?.lat != null && partner?.lng != null ? (
              <Marker
                coordinate={{ latitude: partner.lat, longitude: partner.lng }}
                title={partner.display_name || 'Partner'}
                description={
                  partner.place_name ||
                  (partner.online ? 'Online' : fmtAgo(partner.last_seen))
                }
                pinColor="#f472b6"
              />
            ) : null}
          </MapView>
        </View>

        <View style={styles.distRow}>
          <Text style={styles.distValue}>{fmtDist(pair?.distance_m)}</Text>
          <Text style={styles.distLabel}>apart</Text>
          {stats?.both_online ? (
            <Text style={styles.bothOnline}> · both online</Text>
          ) : null}
          {!!err && <Text style={styles.errorInline}>{err}</Text>}
        </View>

        {/* Partner deep intel — 20+ signals */}
        <PersonIntel title="Partner" person={partner} emptyHint="Not joined yet" />
        <PersonIntel title="You" person={me} emptyHint="Share location to appear" />

        {/* Couple stats */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Couple stats</Text>
          <View style={styles.grid}>
            <IntelTile label="Days together" value={pair?.days_together ?? '—'} />
            <IntelTile label="Now apart" value={fmtDist(pair?.distance_m)} />
            <IntelTile label="Max apart today" value={fmtDist(stats?.max_distance_m_today)} />
            <IntelTile label="Closest today" value={fmtDist(stats?.min_distance_m_today)} />
            <IntelTile label="Care pings" value={stats?.care_pings_total ?? 0} />
            <IntelTile label="Love notes" value={stats?.love_notes_total ?? 0} />
            <IntelTile
              label="Partner traveled"
              value={
                partner?.traveled_m_today != null
                  ? fmtDist(partner.traveled_m_today)
                  : '—'
              }
            />
            <IntelTile label="Partner places" value={partner?.places_today ?? '—'} />
          </View>
        </View>

        {/* Care actions */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Care</Text>
          <View style={styles.rowWrap}>
            <Pressable style={[styles.chip, styles.chipPink]} onPress={sendPing}>
              <Text style={styles.chipText}>💗 Thinking of you</Text>
            </Pressable>
            <Pressable
              style={[styles.chip, me?.sos_active ? styles.chipDanger : styles.chipGhost]}
              onPress={toggleSos}
            >
              <Text style={styles.chipText}>
                {me?.sos_active ? '✅ Clear SOS' : '🚨 SOS'}
              </Text>
            </Pressable>
            <Pressable style={[styles.chip, styles.chipGhost]} onPress={setHomeHere}>
              <Text style={styles.chipText}>🏠 Set home here</Text>
            </Pressable>
          </View>
          <TextInput
            style={[styles.input, { marginTop: 10, marginBottom: 8 }]}
            placeholder="Love note to partner…"
            placeholderTextColor="#64748b"
            value={loveDraft}
            onChangeText={setLoveDraft}
            maxLength={280}
          />
          <Pressable style={[styles.btn, styles.btnPrimary]} onPress={sendLoveNote}>
            <Text style={styles.btnPrimaryText}>Send love note</Text>
          </Pressable>
        </View>

        {/* Activity + mood */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Your activity</Text>
          <View style={styles.rowWrap}>
            {ACTIVITIES.map((a) => (
              <Pressable
                key={a.id}
                style={[styles.chip, activity === a.id && styles.chipPink]}
                onPress={() => pickActivity(a.id)}
              >
                <Text style={styles.chipText}>{a.label}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={[styles.cardTitle, { marginTop: 14 }]}>Mood</Text>
          <View style={styles.rowWrap}>
            {MOODS.map((m) => (
              <Pressable
                key={m}
                style={[styles.moodBtn, mood === m && styles.chipPink]}
                onPress={() => setMood(m)}
              >
                <Text style={{ fontSize: 22 }}>{m}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            style={[styles.input, { marginTop: 10 }]}
            placeholder="Status message"
            placeholderTextColor="#64748b"
            value={statusText}
            onChangeText={setStatusText}
          />
          <Pressable style={[styles.btn, styles.btnPrimary, { marginTop: 10 }]} onPress={heartbeat}>
            <Text style={styles.btnPrimaryText}>Update now</Text>
          </Pressable>
        </View>

        {/* Trail list */}
        {pair?.partner_trail?.length ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Partner trail</Text>
            {[...pair.partner_trail].reverse().slice(0, 8).map((h, i) => (
              <Text key={`${h.ts}-${i}`} style={styles.meta}>
                {fmtAgo(h.ts)}
                {h.place_name ? ` · ${h.place_name}` : ''}
                {h.battery != null ? ` · 🔋${Math.round(h.battery)}%` : ''}
              </Text>
            ))}
          </View>
        ) : null}

        <Text style={styles.footer}>
          {Device.modelName || Platform.OS} · v{APP_VERSION}
          {'\n'}
          Auto-shares live intel with your pair only. Pull to refresh.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function IntelTile({ label, value }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileVal} numberOfLines={2}>
        {value == null || value === '' ? '—' : String(value)}
      </Text>
      <Text style={styles.tileLbl}>{label}</Text>
    </View>
  );
}

function PersonIntel({ title, person, emptyHint }) {
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
  const net =
    person.is_wifi === true
      ? 'Wi‑Fi'
      : person.network ||
        (person.is_internet === false ? 'Offline net' : person.cellular_gen || '—');

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
        {person.app_state ? ` · app ${person.app_state}` : ''}
      </Text>
      <Text style={[styles.batt, { color: bc }]}>
        🔋 {pct != null ? `${Math.round(pct)}%` : '—'}
        {person.charging ? ' ⚡ charging' : ''}
        {person.low_power ? ' · Low Power' : ''}
      </Text>
      {(person.mood || person.status_text || person.activity) && (
        <Text style={styles.statusLine}>
          {person.mood ? `${person.mood} ` : ''}
          {person.activity ? `[${person.activity}] ` : ''}
          {person.status_text || ''}
        </Text>
      )}
      <View style={styles.grid}>
        <IntelTile
          label="Place"
          value={person.place_name || (person.lat != null ? 'GPS only' : 'No GPS')}
        />
        <IntelTile
          label="City"
          value={[person.place_city, person.place_region].filter(Boolean).join(', ') || '—'}
        />
        <IntelTile label="Country" value={person.place_country || '—'} />
        <IntelTile label="Time here" value={fmtDuration(person.time_at_place_s)} />
        <IntelTile label="Motion" value={motionLabel(person.motion)} />
        <IntelTile
          label="Speed"
          value={
            person.speed_kmh != null
              ? `${person.speed_kmh} km/h`
              : person.speed_mps != null
                ? `${(person.speed_mps * 3.6).toFixed(0)} km/h`
                : '—'
          }
        />
        <IntelTile
          label="Heading"
          value={
            person.heading_cardinal ||
            (person.heading != null ? `${Math.round(person.heading)}°` : '—')
          }
        />
        <IntelTile
          label="Altitude"
          value={person.altitude_m != null ? `${Math.round(person.altitude_m)} m` : '—'}
        />
        <IntelTile
          label="GPS accuracy"
          value={person.accuracy_m != null ? `±${Math.round(person.accuracy_m)} m` : '—'}
        />
        <IntelTile
          label="Home"
          value={
            !person.home_set
              ? 'Not set'
              : person.at_home
                ? 'At home'
                : fmtDist(person.dist_from_home_m)
          }
        />
        <IntelTile label="Network" value={net} />
        <IntelTile label="Cell" value={person.cellular_gen || '—'} />
        <IntelTile label="Carrier" value={person.carrier || '—'} />
        <IntelTile
          label="Weather"
          value={
            person.weather_temp_c != null
              ? `${person.weather_temp_c}° · ${person.weather_label || '—'}`
              : '—'
          }
        />
        <IntelTile label="Day / night" value={person.day_night || '—'} />
        <IntelTile
          label="Local hour"
          value={person.local_hour != null ? `${person.local_hour}:00` : '—'}
        />
        <IntelTile label="Timezone" value={person.timezone || '—'} />
        <IntelTile label="Language" value={person.locale || '—'} />
        <IntelTile
          label="Device"
          value={
            [person.device_brand, person.device_model].filter(Boolean).join(' ') ||
            person.platform ||
            '—'
          }
        />
        <IntelTile
          label="OS"
          value={
            [person.os_name, person.os_version].filter(Boolean).join(' ') || '—'
          }
        />
        <IntelTile label="App" value={person.app_version ? `v${person.app_version}` : '—'} />
        <IntelTile label="Traveled today" value={fmtDist(person.traveled_m_today)} />
        <IntelTile label="Places today" value={person.places_today ?? '—'} />
        <IntelTile label="GPS points today" value={person.points_today ?? '—'} />
        <IntelTile label="Pings sent" value={person.ping_count ?? 0} />
        <IntelTile label="Notes sent" value={person.note_count ?? 0} />
        <IntelTile
          label="Coords"
          value={
            person.lat != null
              ? `${Number(person.lat).toFixed(4)}, ${Number(person.lng).toFixed(4)}`
              : '—'
          }
        />
      </View>
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
  sosBanner: { borderColor: '#f87171', backgroundColor: '#2a1218' },
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
    flexWrap: 'wrap',
  },
  distValue: { color: '#f8fafc', fontSize: 28, fontWeight: '900' },
  distLabel: { color: '#94a3b8', marginLeft: 8, fontSize: 14 },
  bothOnline: { color: '#34d399', fontSize: 13, fontWeight: '700' },
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
  statusLine: { color: '#e2e8f0', marginTop: 8, fontStyle: 'italic' },
  muted: { color: '#64748b' },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 10,
    marginHorizontal: -4,
  },
  tile: {
    width: '33.33%',
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  tileVal: { color: '#f8fafc', fontSize: 13, fontWeight: '800' },
  tileLbl: { color: '#64748b', fontSize: 10, marginTop: 2 },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chip: {
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#3b2d55',
    backgroundColor: '#24182e',
  },
  chipPink: { backgroundColor: '#f472b633', borderColor: '#f472b6' },
  chipGhost: { backgroundColor: 'transparent' },
  chipDanger: { backgroundColor: '#f8717133', borderColor: '#f87171' },
  chipText: { color: '#f8fafc', fontSize: 13, fontWeight: '600' },
  moodBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#24182e',
    borderWidth: 1,
    borderColor: '#3b2d55',
  },
  footer: {
    color: '#475569',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 20,
    lineHeight: 16,
  },
});
