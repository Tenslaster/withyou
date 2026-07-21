/**
 * WithYou — private couple presence + deep partner intel
 * Polished product UI · live intel · care · SOS · stats
 */
import React, {
  Component,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  InteractionManager,
  KeyboardAvoidingView,
  Linking,
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

/**
 * Native maps crash many Android builds (Google Maps SDK / no API key).
 * iOS uses Apple Maps via react-native-maps — load it only on iOS.
 */
const USE_NATIVE_MAP = Platform.OS === 'ios';
let MapView = null;
let Marker = null;
let Polyline = null;
if (USE_NATIVE_MAP) {
  try {
    // eslint-disable-next-line global-require
    const maps = require('react-native-maps');
    MapView = maps.default;
    Marker = maps.Marker;
    Polyline = maps.Polyline;
  } catch {
    MapView = null;
  }
}

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
const HEARTBEAT_MS = 22000;
const API_TIMEOUT_MS = 14000;

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

/** Invite codes are 6 hex chars (A–F, 0–9). Strip junk users often paste. */
function cleanInviteCode(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/[^A-F0-9]/g, '')
    .slice(0, 8);
}

/** Stable compare so auto-sync does not re-render the whole UI every few seconds. */
function pairSignature(p) {
  if (!p) return '';
  const m = p.me || {};
  const pr = p.partner || {};
  const st = p.stats || {};
  return [
    p.distance_m,
    p.days_together,
    m.battery != null ? Math.round(Number(m.battery)) : '',
    m.charging ? 1 : 0,
    // Round GPS so tiny noise does not thrash re-renders
    m.lat != null ? Number(m.lat).toFixed(4) : '',
    m.lng != null ? Number(m.lng).toFixed(4) : '',
    m.last_seen ? Math.floor(Number(m.last_seen) / 15) : '',
    m.online ? 1 : 0,
    m.mood,
    m.status_text,
    m.activity,
    m.place_name,
    m.love_note,
    m.thinking_of_you_at ? Math.floor(Number(m.thinking_of_you_at) / 30) : '',
    m.sos_active ? 1 : 0,
    m.motion,
    pr.battery != null ? Math.round(Number(pr.battery)) : '',
    pr.charging ? 1 : 0,
    pr.lat != null ? Number(pr.lat).toFixed(4) : '',
    pr.lng != null ? Number(pr.lng).toFixed(4) : '',
    pr.last_seen ? Math.floor(Number(pr.last_seen) / 15) : '',
    pr.online ? 1 : 0,
    pr.mood,
    pr.status_text,
    pr.activity,
    pr.place_name,
    pr.sos_active ? 1 : 0,
    pr.motion,
    pr.weather_temp_c,
    st.both_online ? 1 : 0,
    st.care_pings_total,
    st.love_notes_total,
    st.max_distance_m_today,
    st.min_distance_m_today,
    (p.partner_trail || []).length,
  ].join('|');
}

const DEFAULT_REGION = {
  latitude: 45.5,
  longitude: -73.6,
  latitudeDelta: 0.08,
  longitudeDelta: 0.08,
};

// --- helpers ----------------------------------------------------------------
async function api(path, { method = 'GET', token, body, timeoutMs = API_TIMEOUT_MS } = {}) {
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': `WithYou/${APP_VERSION} (${Platform.OS})`,
    'X-App-Version': APP_VERSION,
  };
  if (token) headers.Authorization = token;

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer =
    controller && timeoutMs > 0
      ? setTimeout(() => {
          try {
            controller.abort();
          } catch {
            /* ignore */
          }
        }, timeoutMs)
      : null;

  try {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller?.signal,
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
  } catch (e) {
    if (e?.name === 'AbortError') {
      const err = new Error('Network timeout — try again');
      err.status = 408;
      throw err;
    }
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Catches render crashes so one bad frame does not kill the whole app. */
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error) {
    console.warn('[WithYou] render error', error?.message || error);
  }
  render() {
    if (this.state.error) {
      return (
        <SafeAreaView style={{ flex: 1, backgroundColor: '#0B0810', padding: 24, justifyContent: 'center' }}>
          <Text style={{ color: '#F472B6', fontSize: 22, fontWeight: '900', marginBottom: 8 }}>
            WithYou
          </Text>
          <Text style={{ color: '#F8FAFC', fontSize: 16, fontWeight: '700', marginBottom: 8 }}>
            Something went wrong
          </Text>
          <Text style={{ color: '#A8B0C0', lineHeight: 20, marginBottom: 20 }}>
            {String(this.state.error?.message || this.state.error)}
          </Text>
          <SoftPress
            onPress={() => this.setState({ error: null })}
            style={{
              backgroundColor: '#F472B6',
              paddingVertical: 14,
              borderRadius: 14,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: '#1A0A12', fontWeight: '800' }}>Try again</Text>
          </SoftPress>
        </SafeAreaView>
      );
    }
    return this.props.children;
  }
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

function openInMaps(lat, lng, label) {
  if (lat == null || lng == null) return;
  const la = Number(lat);
  const ln = Number(lng);
  if (Number.isNaN(la) || Number.isNaN(ln)) return;
  const q = encodeURIComponent(label || 'WithYou');
  const web = `https://www.google.com/maps/search/?api=1&query=${la},${ln}`;
  const native =
    Platform.OS === 'ios'
      ? `http://maps.apple.com/?ll=${la},${ln}&q=${q}`
      : `geo:${la},${ln}?q=${la},${ln}(${q})`;
  Linking.openURL(native).catch(() => {
    Linking.openURL(web).catch(() => {});
  });
}

/** Crash-safe map: iOS native map; Android location card (no Google Maps SDK). */
class MapBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { crashed: false };
  }
  static getDerivedStateFromError() {
    return { crashed: true };
  }
  componentDidCatch(err) {
    console.warn('[WithYou] map crash', err?.message || err);
  }
  render() {
    if (this.state.crashed) {
      return this.props.fallback || null;
    }
    return this.props.children;
  }
}

// --- App --------------------------------------------------------------------
function WithYouApp() {
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
  const pairSigRef = useRef('');
  const moodRef = useRef('');
  const statusRef = useRef('');
  const activityRef = useRef('');
  const weatherCache = useRef({ at: 0, data: null, key: '' });
  const mapFittedRef = useRef(false);
  const initialMapRegion = useRef(DEFAULT_REGION);
  const hbInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  tokenRef.current = token;
  moodRef.current = mood;
  statusRef.current = statusText;
  activityRef.current = activity;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const partner = pair?.partner;
  const me = pair?.me;
  const stats = pair?.stats;

  const applyPair = useCallback((data, { force = false } = {}) => {
    if (!data) return;
    const sig = pairSignature(data);
    if (!force && sig === pairSigRef.current) return;
    pairSigRef.current = sig;
    setPair(data);
  }, []);

  // Boot session
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const storeOpts =
          Platform.OS === 'ios' && SecureStore.AFTER_FIRST_UNLOCK != null
            ? { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK }
            : undefined;
        const [t, n] = await Promise.all([
          SecureStore.getItemAsync(TOKEN_KEY, storeOpts),
          SecureStore.getItemAsync(NAME_KEY, storeOpts),
        ]);
        if (cancelled) return;
        if (n) setName(n);
        if (t) {
          setToken(t);
          try {
            const data = await api('/me', { token: t });
            if (cancelled) return;
            applyPair(data, { force: true });
            if (data?.me?.mood) setMood(data.me.mood);
            if (data?.me?.status_text) setStatusText(data.me.status_text);
            if (data?.me?.activity) setActivity(data.me.activity);
          } catch {
            try {
              await SecureStore.deleteItemAsync(TOKEN_KEY);
            } catch {
              /* ignore */
            }
            if (!cancelled) setToken(null);
          }
        }
      } finally {
        if (!cancelled) setBoot(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyPair]);

  // Push notifications — never at module load (crashes some Android builds)
  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;
    (async () => {
      try {
        if (typeof Notifications.setNotificationHandler === 'function') {
          Notifications.setNotificationHandler({
            handleNotification: async () => ({
              shouldShowAlert: true,
              shouldPlaySound: true,
              shouldSetBadge: false,
              shouldShowBanner: true,
              shouldShowList: true,
            }),
          });
        }
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
        /* optional — missing FCM / Play services must not crash app */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const collectTelemetry = useCallback(async () => {
    const locales = Localization.getLocales?.() || [];
    const calendars = Localization.getCalendars?.() || [];
    let tz = '';
    let locale = '';
    try {
      tz =
        calendars[0]?.timeZone ||
        Intl.DateTimeFormat().resolvedOptions().timeZone ||
        '';
      locale = locales[0]?.languageTag || '';
    } catch {
      /* ignore */
    }
    const hour = new Date().getHours();
    const body = {
      platform: Platform.OS,
      app_version: APP_VERSION,
      mood: moodRef.current || undefined,
      status_text: statusRef.current || undefined,
      activity: activityRef.current || undefined,
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
      try {
        body.carrier = (await Cellular.getCarrierNameAsync()) || '';
      } catch {
        body.carrier = '';
      }
    } catch {
      /* optional — avoid crash without phone permission */
    }
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
          maximumAge: 15000,
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
  }, []);

  const heartbeat = useCallback(
    async ({ quiet = true } = {}) => {
      const t = tokenRef.current;
      if (!t || !mountedRef.current) return;
      // Skip overlapping background beats (keeps UI smooth)
      if (quiet && hbInFlightRef.current) return;
      hbInFlightRef.current = true;
      if (!quiet && mountedRef.current) setSyncing(true);
      try {
        // Background only: wait for animations so scroll/UI stays smooth
        if (quiet) {
          await new Promise((resolve) => {
            InteractionManager.runAfterInteractions(() => resolve());
          });
        }
        if (!mountedRef.current) return;
        const body = await collectTelemetry();
        if (!mountedRef.current) return;
        const data = await api('/heartbeat', { method: 'POST', token: t, body });
        if (data?.ok && mountedRef.current) applyPair(data);
        if (mountedRef.current) setErr('');
      } catch (e) {
        // Quiet background errors — only show on manual sync
        if (!quiet && mountedRef.current) setErr(e.message || 'Sync failed');
      } finally {
        hbInFlightRef.current = false;
        if (!quiet && mountedRef.current) setSyncing(false);
      }
    },
    [collectTelemetry, applyPair]
  );

  const refresh = useCallback(async () => {
    const t = tokenRef.current;
    if (!t) return;
    setRefreshing(true);
    try {
      // One path: heartbeat already returns full pair — no double /me + layout thrash
      await heartbeat({ quiet: true });
      setErr('');
    } catch (e) {
      setErr(e.message || 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  }, [heartbeat]);

  // Permissions + loops — deps only on token so mood typing does not reset timers
  useEffect(() => {
    if (!token) return undefined;
    let alive = true;
    let hbTimer = null;
    (async () => {
      try {
        const fg = await Location.requestForegroundPermissionsAsync();
        if (fg.status === 'granted') {
          try {
            await Location.requestBackgroundPermissionsAsync();
          } catch {
            /* optional */
          }
        }
      } catch {
        /* ignore */
      }
      if (alive) heartbeat({ quiet: true });
    })();
    hbTimer = setInterval(() => {
      if (AppState.currentState === 'active') heartbeat({ quiet: true });
    }, HEARTBEAT_MS);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') heartbeat({ quiet: true });
    });
    return () => {
      alive = false;
      if (hbTimer) clearInterval(hbTimer);
      sub.remove();
    };
  }, [token, heartbeat]);

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
      const storeOpts =
        Platform.OS === 'ios' && SecureStore.AFTER_FIRST_UNLOCK != null
          ? { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK }
          : undefined;
      await SecureStore.setItemAsync(TOKEN_KEY, data.token, storeOpts);
      await SecureStore.setItemAsync(NAME_KEY, n, storeOpts);
      setToken(data.token);
      setCreatedInvite(data.invite_code || '');
      applyPair(
        {
          me: data.me,
          partner: data.partner,
          invite_code: data.invite_code,
          days_together: data.days_together ?? 0,
          distance_m: null,
          partner_joined: false,
        },
        { force: true }
      );
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
      const storeOpts =
        Platform.OS === 'ios' && SecureStore.AFTER_FIRST_UNLOCK != null
          ? { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK }
          : undefined;
      await SecureStore.setItemAsync(TOKEN_KEY, data.token, storeOpts);
      await SecureStore.setItemAsync(NAME_KEY, n, storeOpts);
      setToken(data.token);
      applyPair(data, { force: true });
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
          pairSigRef.current = '';
          mapFittedRef.current = false;
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
      applyPair(data, { force: true });
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
      applyPair(data, { force: true });
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
              applyPair(data, { force: true });
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
        applyPair(data, { force: true });
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
      applyPair(data, { force: true });
      Alert.alert('Home saved', 'Partner can see when you are at home.');
      heartbeat({ quiet: false });
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
      applyPair(data, { force: true });
      heartbeat({ quiet: true });
    } catch {
      /* heartbeat will sync */
    }
  };

  // iOS only: fit native map once when GPS appears
  useEffect(() => {
    if (!USE_NATIVE_MAP || !MapView) return;
    if (tab !== 'live') return;
    const pts = [];
    if (me?.lat != null && me?.lng != null) {
      pts.push({ latitude: Number(me.lat), longitude: Number(me.lng) });
    }
    if (partner?.lat != null && partner?.lng != null) {
      pts.push({ latitude: Number(partner.lat), longitude: Number(partner.lng) });
    }
    if (!pts.length || !mapRef.current) return;
    if (mapFittedRef.current) return;
    try {
      if (pts.length === 1) {
        const r = {
          ...pts[0],
          latitudeDelta: 0.025,
          longitudeDelta: 0.025,
        };
        initialMapRegion.current = r;
        mapRef.current.animateToRegion?.(r, 400);
      } else {
        mapRef.current.fitToCoordinates?.(pts, {
          edgePadding: { top: 48, right: 48, bottom: 48, left: 48 },
          animated: true,
        });
      }
      mapFittedRef.current = true;
    } catch {
      /* map not ready */
    }
  }, [me?.lat, me?.lng, partner?.lat, partner?.lng, tab]);

  const trailCoords = useMemo(() => {
    const t = pair?.partner_trail || [];
    return t
      .filter((h) => h.lat != null && h.lng != null)
      .map((h) => ({ latitude: Number(h.lat), longitude: Number(h.lng) }));
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
        keyboardShouldPersistTaps="handled"
        // Keep scroll position stable while pair data updates in background
        removeClippedSubviews={Platform.OS === 'android'}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={T.pink}
            colors={[T.pink]}
            progressBackgroundColor={T.card}
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
            <LocationPanel
              me={me}
              partner={partner}
              distanceM={pair?.distance_m}
              trailCoords={trailCoords}
              mapRef={mapRef}
              initialRegion={initialMapRegion.current}
            />

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
                <SoftPress
                  style={styles.actionTile}
                  onPress={() => heartbeat({ quiet: false })}
                >
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
                onPress={() => heartbeat({ quiet: false })}
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

/** Location UI — Android never mounts native MapView (crash fix). */
function LocationPanel({ me, partner, distanceM, trailCoords, mapRef, initialRegion }) {
  const locationFallback = (
    <Card accent="blue" style={{ marginBottom: 12 }}>
      <SectionLabel>Location</SectionLabel>
      <Text style={styles.heroDist}>{fmtDist(distanceM)}</Text>
      <Text style={styles.heroSub}>apart right now</Text>
      <View style={[styles.grid, { marginTop: 8 }]}>
        <Metric
          label="Partner"
          value={
            partner?.place_name ||
            (partner?.lat != null
              ? `${Number(partner.lat).toFixed(3)}, ${Number(partner.lng).toFixed(3)}`
              : 'No GPS')
          }
        />
        <Metric
          label="You"
          value={
            me?.place_name ||
            (me?.lat != null
              ? `${Number(me.lat).toFixed(3)}, ${Number(me.lng).toFixed(3)}`
              : 'No GPS')
          }
        />
        <Metric label="Motion" value={motionLabel(partner?.motion)} />
      </View>
      <View style={[styles.rowWrap, { marginTop: 12 }]}>
        {partner?.lat != null ? (
          <SoftPress
            style={styles.chip}
            onPress={() =>
              openInMaps(partner.lat, partner.lng, partner.display_name || 'Partner')
            }
          >
            <Text style={styles.chipText}>Open partner in Maps</Text>
          </SoftPress>
        ) : null}
        {me?.lat != null ? (
          <SoftPress
            style={styles.chip}
            onPress={() => openInMaps(me.lat, me.lng, me.display_name || 'Me')}
          >
            <Text style={styles.chipText}>Open me in Maps</Text>
          </SoftPress>
        ) : null}
      </View>
      {Platform.OS === 'android' ? (
        <Text style={[styles.metaLine, { marginTop: 10 }]}>
          Built-in map is off on Android for stability. Use the buttons to open Google Maps.
        </Text>
      ) : null}
    </Card>
  );

  // Android / missing native maps: never create MapView
  if (!USE_NATIVE_MAP || !MapView) {
    return locationFallback;
  }

  return (
    <MapBoundary fallback={locationFallback}>
      <View style={styles.mapWrap}>
        <MapView
          ref={mapRef}
          style={styles.map}
          initialRegion={initialRegion}
          rotateEnabled={false}
          pitchEnabled={false}
          toolbarEnabled={false}
          moveOnMarkerPress={false}
          loadingEnabled={false}
        >
          {Polyline && trailCoords.length > 1 ? (
            <Polyline
              coordinates={trailCoords}
              strokeColor="#F472B6AA"
              strokeWidth={3}
            />
          ) : null}
          {Marker && me?.lat != null && me?.lng != null ? (
            <Marker
              coordinate={{
                latitude: Number(me.lat),
                longitude: Number(me.lng),
              }}
              title={me.display_name || 'You'}
              description={me.place_name || 'You'}
              pinColor="#38bdf8"
              tracksViewChanges={false}
            />
          ) : null}
          {Marker && partner?.lat != null && partner?.lng != null ? (
            <Marker
              coordinate={{
                latitude: Number(partner.lat),
                longitude: Number(partner.lng),
              }}
              title={partner.display_name || 'Partner'}
              description={
                partner.place_name ||
                (partner.online ? 'Online' : fmtAgo(partner.last_seen))
              }
              pinColor="#f472b6"
              tracksViewChanges={false}
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
    </MapBoundary>
  );
}

const PersonHero = memo(function PersonHero({ person, title, empty, tone = 'pink' }) {
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
});

const PersonIntel = memo(function PersonIntel({ person, title, empty, tone = 'pink' }) {
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
});

export default function App() {
  return (
    <ErrorBoundary>
      <WithYouApp />
    </ErrorBoundary>
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
