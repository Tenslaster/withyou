/**
 * WithYou — private couple presence + deep partner intel
 * Polished product UI · live intel · care · SOS · stats
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
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
import {
  T,
  SoftPress,
  PrimaryButton,
  GhostButton,
  Card,
  SectionLabel,
  Pill,
  Avatar,
  BatteryBar,
  Metric,
  Segmented,
  AlertBanner,
  Input,
  hapticSuccess,
} from './theme';

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
  const [tab, setTab] = useState('live'); // live | intel | care | me
  const [syncing, setSyncing] = useState(false);
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
    setSyncing(true);
    try {
      const body = await collectTelemetry();
      const data = await api('/heartbeat', { method: 'POST', token: t, body });
      if (data?.ok) setPair(data);
      setErr('');
    } catch (e) {
      setErr(e.message || 'Sync failed');
    } finally {
      setSyncing(false);
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
      hapticSuccess();
      Alert.alert('Sent', 'Your partner will see this note.');
    } catch (e) {
      Alert.alert('Failed', e.message || 'Could not send');
    }
  };

  const sendPing = async () => {
    try {
      const data = await api('/care/ping', { method: 'POST', token, body: {} });
      setPair(data);
      hapticSuccess();
      Alert.alert('Sent', 'Thinking of you — partner notified.');
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
      <View style={styles.boot}>
        <StatusBar style="light" />
        <LinearGradient
          colors={['#1A1024', T.bg, '#0B0810']}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.bootBadge}>
          <LinearGradient
            colors={['#FBCFE8', '#F472B6', '#DB2777']}
            style={styles.bootLogo}
          >
            <Text style={{ fontSize: 36 }}>💕</Text>
          </LinearGradient>
        </View>
        <Text style={styles.bootText}>WithYou</Text>
        <Text style={styles.bootSub}>Private couple presence</Text>
        <ActivityIndicator color={T.pink} style={{ marginTop: 28 }} />
      </View>
    );
  }

  // --- Pairing screen ---
  if (!token) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar style="light" />
        <LinearGradient
          colors={['#1A1024', T.bg]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.pad}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.pairHero}>
              <LinearGradient
                colors={['#FBCFE8', '#F472B6', '#DB2777']}
                style={styles.bootLogo}
              >
                <Text style={{ fontSize: 32 }}>💕</Text>
              </LinearGradient>
              <Text style={styles.logo}>WithYou</Text>
              <Text style={styles.tagline}>
                Live presence for two. Create a pair, share a code, stay close.
              </Text>
            </View>

            <Card>
              <SectionLabel>Join with code</SectionLabel>
              <Input
                placeholder="6-character invite code"
                autoCapitalize="characters"
                autoCorrect={false}
                autoComplete="off"
                textContentType="oneTimeCode"
                value={inviteInput}
                onChangeText={(t) => setInviteInput(cleanInviteCode(t))}
                maxLength={8}
                style={styles.codeInput}
              />
              <GhostButton title="Join pair" onPress={joinPair} loading={busy} />
            </Card>

            <View style={styles.divider}>
              <View style={styles.divLine} />
              <Text style={styles.dividerText}>or create</Text>
              <View style={styles.divLine} />
            </View>

            <Card>
              <SectionLabel>Start a new pair</SectionLabel>
              <Text style={styles.fieldHint}>Name (optional)</Text>
              <Input
                placeholder="e.g. Alex"
                value={name}
                onChangeText={setName}
                autoCorrect={false}
                returnKeyType="done"
              />
              <Text style={[styles.fieldHint, { marginTop: 10 }]}>Emoji</Text>
              <Input value={emoji} onChangeText={setEmoji} maxLength={4} />
              <PrimaryButton
                title="Create pair · get code"
                onPress={createPair}
                loading={busy}
                style={{ marginTop: 8 }}
              />
            </Card>

            {!!err && (
              <AlertBanner title="Something went wrong" body={err} tone="red" />
            )}

            <Text style={styles.hint}>
              Phone A creates · Phone B joins with the code only{'\n'}
              Encrypted to your private server · v{APP_VERSION}
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
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={T.pink}
            colors={[T.pink]}
          />
        }
      >
        {/* App bar */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.logoSm}>WithYou</Text>
            <View style={styles.headerMeta}>
              <Pill
                label={
                  pair?.days_together != null
                    ? `${pair.days_together}d together`
                    : 'New pair'
                }
                tone="pink"
              />
              {syncing ? (
                <Pill label="Syncing" tone="blue" />
              ) : stats?.both_online ? (
                <Pill label="Both online" tone="ok" dot />
              ) : (
                <Pill
                  label={partner?.online ? 'Partner online' : 'Live'}
                  tone={partner?.online ? 'ok' : 'neutral'}
                  dot={!!partner?.online}
                />
              )}
            </View>
          </View>
          <SoftPress onPress={leavePair} hitSlop={12}>
            <Text style={styles.leave}>Leave</Text>
          </SoftPress>
        </View>

        {partner?.sos_active ? (
          <AlertBanner
            title="Partner SOS"
            body={partner.sos_message || 'Needs you now'}
            meta={fmtAgo(partner.sos_at)}
            tone="red"
          />
        ) : null}

        {me?.love_note ? (
          <AlertBanner
            title={`Note from ${me.love_note_from || 'partner'}`}
            body={me.love_note}
            meta={fmtAgo(me.love_note_at)}
            tone="pink"
          />
        ) : null}

        {me?.thinking_of_you_at ? (
          <AlertBanner
            title="Thinking of you"
            body={`Partner pinged you ${fmtAgo(me.thinking_of_you_at)}`}
            tone="pink"
          />
        ) : null}

        {!pair?.partner_joined && !partner ? (
          <Card style={styles.mx} accent="pink">
            <SectionLabel>Waiting for partner</SectionLabel>
            <Text style={styles.waitBody}>
              Share this invite code. They only need the code to join.
            </Text>
            <Text style={styles.inviteCode}>
              {createdInvite || pair?.invite_code || '—'}
            </Text>
            <PrimaryButton
              title="Share invite code"
              onPress={() => {
                const code = createdInvite || pair?.invite_code || '';
                if (!code) return;
                Share.share({ message: `Join me on WithYou! Invite code: ${code}` }).catch(
                  () => {}
                );
              }}
              style={{ marginTop: 8 }}
            />
          </Card>
        ) : null}

        {/* Hero distance */}
        <Card style={styles.mx} accent="blue">
          <View style={styles.heroRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroLabel}>Distance</Text>
              <Text style={styles.heroDist}>{fmtDist(pair?.distance_m)}</Text>
              <Text style={styles.heroSub}>
                {partner?.place_name
                  ? `Partner · ${partner.place_name}`
                  : partner
                    ? `Last seen ${fmtAgo(partner.last_seen)}`
                    : 'Waiting for partner'}
              </Text>
            </View>
            <View style={styles.heroAvatars}>
              <Avatar
                emoji={me?.emoji}
                online={me?.online}
                tone="blue"
                size={44}
              />
              <View style={{ width: 8 }} />
              <Avatar
                emoji={partner?.emoji || '💗'}
                online={partner?.online}
                tone="pink"
                size={44}
              />
            </View>
          </View>
          {!!err && <Text style={styles.errorInline}>{err}</Text>}
        </Card>

        {/* Tabs */}
        <Segmented
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'live', label: 'Live' },
            { id: 'intel', label: 'Intel' },
            { id: 'care', label: 'Care' },
            { id: 'me', label: 'You' },
          ]}
        />

        {tab === 'live' ? (
          <View style={styles.tabPad}>
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
                  <Polyline
                    coordinates={trailCoords}
                    strokeColor="#F472B6AA"
                    strokeWidth={3}
                  />
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
              <View style={styles.mapOverlay}>
                <Pill
                  label={partner?.motion ? motionLabel(partner.motion) : 'Map'}
                  tone="pink"
                />
              </View>
            </View>

            <PersonHero person={partner} title="Partner" empty="Not joined yet" />
            <PersonHero person={me} title="You" empty="Enable location" tone="blue" />

            <Card>
              <SectionLabel>Today</SectionLabel>
              <View style={styles.grid}>
                <Metric label="Days" value={pair?.days_together ?? '—'} icon="📅" />
                <Metric label="Apart now" value={fmtDist(pair?.distance_m)} icon="📍" />
                <Metric
                  label="Max apart"
                  value={fmtDist(stats?.max_distance_m_today)}
                  icon="↔️"
                />
                <Metric
                  label="Closest"
                  value={fmtDist(stats?.min_distance_m_today)}
                  icon="💞"
                />
                <Metric label="Pings" value={stats?.care_pings_total ?? 0} icon="💗" />
                <Metric label="Notes" value={stats?.love_notes_total ?? 0} icon="✉️" />
              </View>
            </Card>
          </View>
        ) : null}

        {tab === 'intel' ? (
          <View style={styles.tabPad}>
            <PersonIntel person={partner} title="Partner" empty="Not joined yet" />
            <PersonIntel person={me} title="You" empty="Share location" tone="blue" />
            {pair?.partner_trail?.length ? (
              <Card>
                <SectionLabel>Partner trail</SectionLabel>
                {[...pair.partner_trail]
                  .reverse()
                  .slice(0, 8)
                  .map((h, i) => (
                    <View key={`${h.ts}-${i}`} style={styles.trailRow}>
                      <View style={styles.trailDot} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.trailTitle}>
                          {h.place_name || 'Location update'}
                        </Text>
                        <Text style={styles.trailMeta}>
                          {fmtAgo(h.ts)}
                          {h.battery != null
                            ? ` · ${Math.round(h.battery)}% battery`
                            : ''}
                        </Text>
                      </View>
                    </View>
                  ))}
              </Card>
            ) : null}
          </View>
        ) : null}

        {tab === 'care' ? (
          <View style={styles.tabPad}>
            <Card>
              <SectionLabel>Quick actions</SectionLabel>
              <View style={styles.actionGrid}>
                <SoftPress style={styles.actionTile} onPress={sendPing} haptic="success">
                  <Text style={styles.actionEmoji}>💗</Text>
                  <Text style={styles.actionLbl}>Thinking of you</Text>
                </SoftPress>
                <SoftPress
                  style={[styles.actionTile, me?.sos_active && styles.actionDanger]}
                  onPress={toggleSos}
                  haptic="med"
                >
                  <Text style={styles.actionEmoji}>{me?.sos_active ? '✅' : '🚨'}</Text>
                  <Text style={styles.actionLbl}>
                    {me?.sos_active ? 'Clear SOS' : 'Send SOS'}
                  </Text>
                </SoftPress>
                <SoftPress style={styles.actionTile} onPress={setHomeHere}>
                  <Text style={styles.actionEmoji}>🏠</Text>
                  <Text style={styles.actionLbl}>Set home here</Text>
                </SoftPress>
                <SoftPress style={styles.actionTile} onPress={heartbeat}>
                  <Text style={styles.actionEmoji}>↻</Text>
                  <Text style={styles.actionLbl}>Sync now</Text>
                </SoftPress>
              </View>
            </Card>
            <Card>
              <SectionLabel>Love note</SectionLabel>
              <Input
                placeholder="Write something sweet…"
                value={loveDraft}
                onChangeText={setLoveDraft}
                maxLength={280}
                multiline
                style={{ minHeight: 72, textAlignVertical: 'top' }}
              />
              <PrimaryButton title="Send note" onPress={sendLoveNote} style={{ marginTop: 10 }} />
            </Card>
          </View>
        ) : null}

        {tab === 'me' ? (
          <View style={styles.tabPad}>
            <Card>
              <SectionLabel>Activity</SectionLabel>
              <View style={styles.rowWrap}>
                {ACTIVITIES.map((a) => (
                  <SoftPress
                    key={a.id}
                    style={[styles.chip, activity === a.id && styles.chipOn]}
                    onPress={() => pickActivity(a.id)}
                  >
                    <Text style={styles.chipText}>{a.label}</Text>
                  </SoftPress>
                ))}
              </View>
            </Card>
            <Card>
              <SectionLabel>Mood</SectionLabel>
              <View style={styles.rowWrap}>
                {MOODS.map((m) => (
                  <SoftPress
                    key={m}
                    style={[styles.moodBtn, mood === m && styles.chipOn]}
                    onPress={() => setMood(m)}
                  >
                    <Text style={{ fontSize: 22 }}>{m}</Text>
                  </SoftPress>
                ))}
              </View>
              <Text style={[styles.fieldHint, { marginTop: 14 }]}>Status</Text>
              <Input
                placeholder="What are you up to?"
                value={statusText}
                onChangeText={setStatusText}
              />
              <PrimaryButton
                title="Update status"
                onPress={heartbeat}
                loading={syncing}
                style={{ marginTop: 10 }}
              />
            </Card>
            <Card>
              <SectionLabel>Device</SectionLabel>
              <Text style={styles.metaLine}>
                {Device.modelName || Platform.OS} · v{APP_VERSION}
              </Text>
              <Text style={styles.metaLine}>
                Auto-shares live intel with your pair only.
              </Text>
              {(createdInvite || pair?.invite_code) && (
                <Text style={[styles.metaLine, { color: T.pink, marginTop: 8 }]}>
                  Invite · {createdInvite || pair?.invite_code}
                </Text>
              )}
            </Card>
          </View>
        ) : null}

        <Text style={styles.footer}>Pull to refresh · Private by design</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function PersonHero({ person, title, empty, tone = 'pink' }) {
  if (!person) {
    return (
      <Card>
        <SectionLabel>{title}</SectionLabel>
        <Text style={styles.muted}>{empty}</Text>
      </Card>
    );
  }
  return (
    <Card accent={tone === 'blue' ? 'blue' : 'pink'}>
      <View style={styles.personHead}>
        <Avatar
          emoji={person.emoji}
          online={person.online}
          tone={tone}
          size={52}
        />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.personName}>{person.display_name || title}</Text>
          <Text style={styles.personSub}>
            {person.online ? 'Online' : 'Offline'} · {fmtAgo(person.last_seen)}
          </Text>
          {(person.mood || person.activity || person.status_text) && (
            <Text style={styles.statusLine} numberOfLines={2}>
              {person.mood ? `${person.mood} ` : ''}
              {person.activity ? `${person.activity} · ` : ''}
              {person.status_text || ''}
            </Text>
          )}
        </View>
        <Pill
          label={person.online ? 'Live' : 'Away'}
          tone={person.online ? 'ok' : 'neutral'}
          dot
        />
      </View>
      <BatteryBar
        pct={person.battery}
        charging={person.charging}
        lowPower={person.low_power}
      />
      <View style={[styles.grid, { marginTop: 4 }]}>
        <Metric
          label="Place"
          value={person.place_name || (person.lat != null ? 'GPS' : '—')}
        />
        <Metric label="Motion" value={motionLabel(person.motion)} />
        <Metric
          label="Weather"
          value={
            person.weather_temp_c != null
              ? `${person.weather_temp_c}°`
              : '—'
          }
        />
      </View>
    </Card>
  );
}

function PersonIntel({ person, title, empty, tone = 'pink' }) {
  if (!person) {
    return (
      <Card>
        <SectionLabel>{title}</SectionLabel>
        <Text style={styles.muted}>{empty}</Text>
      </Card>
    );
  }
  const net =
    person.is_wifi === true
      ? 'Wi‑Fi'
      : person.network ||
        (person.is_internet === false ? 'Offline' : person.cellular_gen || '—');

  return (
    <Card accent={tone === 'blue' ? 'blue' : undefined}>
      <View style={styles.personHead}>
        <Avatar emoji={person.emoji} online={person.online} tone={tone} size={48} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.personName}>{person.display_name || title}</Text>
          <Text style={styles.personSub}>
            {person.online ? 'Online' : 'Offline'} · {fmtAgo(person.last_seen)}
          </Text>
        </View>
      </View>
      <BatteryBar
        pct={person.battery}
        charging={person.charging}
        lowPower={person.low_power}
      />
      <View style={styles.grid}>
        <Metric label="Place" value={person.place_name || '—'} />
        <Metric
          label="City"
          value={[person.place_city, person.place_region].filter(Boolean).join(', ') || '—'}
        />
        <Metric label="Country" value={person.place_country || '—'} />
        <Metric label="Time here" value={fmtDuration(person.time_at_place_s)} />
        <Metric label="Motion" value={motionLabel(person.motion)} />
        <Metric
          label="Speed"
          value={
            person.speed_kmh != null
              ? `${person.speed_kmh} km/h`
              : person.speed_mps != null
                ? `${(person.speed_mps * 3.6).toFixed(0)} km/h`
                : '—'
          }
        />
        <Metric
          label="Heading"
          value={
            person.heading_cardinal ||
            (person.heading != null ? `${Math.round(person.heading)}°` : '—')
          }
        />
        <Metric
          label="Altitude"
          value={person.altitude_m != null ? `${Math.round(person.altitude_m)} m` : '—'}
        />
        <Metric
          label="Accuracy"
          value={person.accuracy_m != null ? `±${Math.round(person.accuracy_m)} m` : '—'}
        />
        <Metric
          label="Home"
          value={
            !person.home_set
              ? 'Not set'
              : person.at_home
                ? 'At home'
                : fmtDist(person.dist_from_home_m)
          }
        />
        <Metric label="Network" value={net} />
        <Metric label="Cell" value={person.cellular_gen || '—'} />
        <Metric label="Carrier" value={person.carrier || '—'} />
        <Metric
          label="Weather"
          value={
            person.weather_temp_c != null
              ? `${person.weather_temp_c}° ${person.weather_label || ''}`
              : '—'
          }
        />
        <Metric label="Day/night" value={person.day_night || '—'} />
        <Metric
          label="Local hour"
          value={person.local_hour != null ? `${person.local_hour}:00` : '—'}
        />
        <Metric label="Timezone" value={person.timezone || '—'} />
        <Metric label="Language" value={person.locale || '—'} />
        <Metric
          label="Device"
          value={
            [person.device_brand, person.device_model].filter(Boolean).join(' ') ||
            person.platform ||
            '—'
          }
        />
        <Metric
          label="OS"
          value={[person.os_name, person.os_version].filter(Boolean).join(' ') || '—'}
        />
        <Metric label="App" value={person.app_version ? `v${person.app_version}` : '—'} />
        <Metric label="Traveled" value={fmtDist(person.traveled_m_today)} />
        <Metric label="Places" value={person.places_today ?? '—'} />
        <Metric label="Points" value={person.points_today ?? '—'} />
        <Metric label="Pings" value={person.ping_count ?? 0} />
        <Metric label="Notes" value={person.note_count ?? 0} />
        <Metric
          label="Coords"
          value={
            person.lat != null
              ? `${Number(person.lat).toFixed(3)}, ${Number(person.lng).toFixed(3)}`
              : '—'
          }
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: T.bg },
  boot: {
    flex: 1,
    backgroundColor: T.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bootBadge: { marginBottom: 16 },
  bootLogo: {
    width: 72,
    height: 72,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bootText: {
    color: T.text,
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  bootSub: { color: T.textMuted, marginTop: 6, fontSize: 14 },
  pad: { padding: 20, paddingTop: 28, paddingBottom: 48 },
  padBottom: { paddingBottom: 48 },
  tabPad: { paddingHorizontal: 16 },
  mx: { marginHorizontal: 16 },
  pairHero: { alignItems: 'center', marginBottom: 28, marginTop: 12 },
  logo: {
    color: T.text,
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: -0.6,
    marginTop: 14,
  },
  logoSm: {
    color: T.text,
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.4,
  },
  tagline: {
    color: T.textSecondary,
    marginTop: 10,
    lineHeight: 21,
    textAlign: 'center',
    paddingHorizontal: 12,
    fontSize: 15,
  },
  fieldHint: {
    color: T.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  codeInput: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 4,
    textAlign: 'center',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 18,
    gap: 10,
  },
  divLine: { flex: 1, height: 1, backgroundColor: T.cardBorderStrong },
  dividerText: { color: T.textDim, fontSize: 12, fontWeight: '600' },
  hint: {
    color: T.textDim,
    fontSize: 12,
    marginTop: 20,
    lineHeight: 18,
    textAlign: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 12,
  },
  headerLeft: { flex: 1 },
  headerMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  leave: { color: T.red, fontWeight: '700', fontSize: 14, paddingTop: 4 },
  waitBody: { color: T.textSecondary, lineHeight: 20, marginBottom: 8 },
  inviteCode: {
    color: T.pink,
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: 4,
    textAlign: 'center',
    marginVertical: 12,
  },
  heroRow: { flexDirection: 'row', alignItems: 'center' },
  heroLabel: {
    color: T.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  heroDist: {
    color: T.text,
    fontSize: 36,
    fontWeight: '900',
    letterSpacing: -1,
    marginTop: 2,
  },
  heroSub: { color: T.textSecondary, marginTop: 4, fontSize: 13 },
  heroAvatars: { flexDirection: 'row', alignItems: 'center' },
  errorInline: { color: T.red, fontSize: 12, marginTop: 10 },
  mapWrap: {
    height: 280,
    borderRadius: T.radiusLg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: T.cardBorder,
    marginBottom: 12,
  },
  map: { flex: 1 },
  mapOverlay: { position: 'absolute', top: 12, left: 12 },
  personHead: { flexDirection: 'row', alignItems: 'center' },
  personName: {
    color: T.text,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  personSub: { color: T.textMuted, fontSize: 12, marginTop: 2 },
  statusLine: {
    color: T.textSecondary,
    marginTop: 6,
    fontSize: 13,
    fontStyle: 'italic',
  },
  muted: { color: T.textMuted, fontSize: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: T.cardBorderStrong,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  chipOn: {
    backgroundColor: T.pinkSoft,
    borderColor: 'rgba(244,114,182,0.45)',
  },
  chipText: { color: T.text, fontSize: 13, fontWeight: '600' },
  moodBtn: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: T.cardBorderStrong,
  },
  actionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  actionTile: {
    width: '47%',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: T.cardBorder,
    paddingVertical: 18,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  actionDanger: {
    borderColor: 'rgba(248,113,113,0.45)',
    backgroundColor: T.redSoft,
  },
  actionEmoji: { fontSize: 26, marginBottom: 8 },
  actionLbl: {
    color: T.text,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  trailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: T.cardBorder,
  },
  trailDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: T.pink,
    marginTop: 5,
    marginRight: 10,
  },
  trailTitle: { color: T.text, fontWeight: '700', fontSize: 14 },
  trailMeta: { color: T.textMuted, fontSize: 12, marginTop: 2 },
  metaLine: { color: T.textSecondary, fontSize: 13, lineHeight: 20 },
  footer: {
    color: T.textDim,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 12,
  },
});
