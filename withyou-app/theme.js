/**
 * WithYou design system — premium couple app polish
 */
import React, { useRef } from 'react';
import {
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';

export const T = {
  bg: '#0B0810',
  bgElevated: '#14101A',
  card: '#16121F',
  cardBorder: 'rgba(255,255,255,0.06)',
  cardBorderStrong: 'rgba(255,255,255,0.10)',
  pink: '#F472B6',
  pinkSoft: 'rgba(244,114,182,0.14)',
  pinkGlow: 'rgba(244,114,182,0.35)',
  blue: '#38BDF8',
  blueSoft: 'rgba(56,189,248,0.12)',
  green: '#34D399',
  greenSoft: 'rgba(52,211,153,0.14)',
  amber: '#FBBF24',
  red: '#F87171',
  redSoft: 'rgba(248,113,113,0.14)',
  text: '#F8FAFC',
  textSecondary: '#A8B0C0',
  textMuted: '#6B7289',
  textDim: '#4B5163',
  radius: 16,
  radiusSm: 12,
  radiusLg: 22,
  space: 16,
  font: Platform.select({ ios: 'System', android: 'sans-serif', default: 'System' }),
};

export function hapticLight() {
  try {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  } catch {
    /* optional */
  }
}

export function hapticMed() {
  try {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  } catch {
    /* optional */
  }
}

export function hapticSuccess() {
  try {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {
    /* optional */
  }
}

/** Pressable with soft scale + opacity — feels like production apps */
export function SoftPress({
  children,
  onPress,
  style,
  disabled,
  haptic = 'light',
  accessibilityLabel,
  hitSlop,
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const pressIn = () => {
    Animated.spring(scale, {
      toValue: 0.97,
      useNativeDriver: true,
      friction: 6,
      tension: 200,
    }).start();
  };
  const pressOut = () => {
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      friction: 5,
      tension: 160,
    }).start();
  };
  return (
    <Pressable
      disabled={disabled}
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPressIn={pressIn}
      onPressOut={pressOut}
      onPress={() => {
        if (disabled) return;
        if (haptic === 'med') hapticMed();
        else if (haptic === 'success') hapticSuccess();
        else if (haptic !== 'none') hapticLight();
        onPress?.();
      }}
      style={({ pressed }) => [{ opacity: disabled ? 0.45 : pressed ? 0.92 : 1 }, style]}
    >
      <Animated.View style={{ transform: [{ scale }] }}>{children}</Animated.View>
    </Pressable>
  );
}

export function PrimaryButton({ title, onPress, loading, disabled, style }) {
  return (
    <SoftPress
      onPress={onPress}
      disabled={disabled || loading}
      haptic="med"
      style={[ui.btnWrap, style]}
    >
      <LinearGradient
        colors={['#FB8EC4', '#F472B6', '#E85A9E']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={ui.btnPrimary}
      >
        {loading ? (
          <Text style={ui.btnPrimaryText}>Please wait…</Text>
        ) : (
          <Text style={ui.btnPrimaryText}>{title}</Text>
        )}
      </LinearGradient>
    </SoftPress>
  );
}

export function GhostButton({ title, onPress, loading, disabled, style, danger }) {
  return (
    <SoftPress
      onPress={onPress}
      disabled={disabled || loading}
      style={[
        ui.btnGhost,
        danger && { borderColor: T.red },
        style,
      ]}
    >
      <Text style={[ui.btnGhostText, danger && { color: T.red }]}>
        {loading ? '…' : title}
      </Text>
    </SoftPress>
  );
}

export function Card({ children, style, accent }) {
  return (
    <View
      style={[
        ui.card,
        accent === 'pink' && { borderColor: 'rgba(244,114,182,0.28)' },
        accent === 'red' && { borderColor: 'rgba(248,113,113,0.4)', backgroundColor: '#1C1014' },
        accent === 'blue' && { borderColor: 'rgba(56,189,248,0.25)' },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function SectionLabel({ children, right }) {
  return (
    <View style={ui.sectionRow}>
      <Text style={ui.sectionLabel}>{children}</Text>
      {right || null}
    </View>
  );
}

export function Pill({ label, tone = 'neutral', dot }) {
  const tones = {
    ok: { bg: T.greenSoft, fg: T.green },
    warn: { bg: 'rgba(251,191,36,0.14)', fg: T.amber },
    bad: { bg: T.redSoft, fg: T.red },
    pink: { bg: T.pinkSoft, fg: T.pink },
    blue: { bg: T.blueSoft, fg: T.blue },
    neutral: { bg: 'rgba(255,255,255,0.06)', fg: T.textSecondary },
  };
  const t = tones[tone] || tones.neutral;
  return (
    <View style={[ui.pill, { backgroundColor: t.bg }]}>
      {dot ? <View style={[ui.pillDot, { backgroundColor: t.fg }]} /> : null}
      <Text style={[ui.pillText, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

export function Avatar({ emoji, name, size = 48, online, tone = 'pink' }) {
  const ring = tone === 'blue' ? T.blue : T.pink;
  return (
    <View style={{ width: size, height: size }}>
      <LinearGradient
        colors={
          tone === 'blue'
            ? ['#7DD3FC', '#38BDF8', '#0EA5E9']
            : ['#FBCFE8', '#F472B6', '#DB2777']
        }
        style={[
          ui.avatar,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderColor: `${ring}55`,
          },
        ]}
      >
        <Text style={{ fontSize: size * 0.42 }}>{emoji || '💕'}</Text>
      </LinearGradient>
      {online != null ? (
        <View
          style={[
            ui.onlineDot,
            {
              backgroundColor: online ? T.green : T.textDim,
              borderColor: T.bg,
              width: size * 0.28,
              height: size * 0.28,
              borderRadius: size * 0.14,
              right: 0,
              bottom: 0,
            },
          ]}
        />
      ) : null}
      {!!name && size >= 56 ? (
        <Text style={ui.avatarName} numberOfLines={1}>
          {name}
        </Text>
      ) : null}
    </View>
  );
}

export function BatteryBar({ pct, charging, lowPower }) {
  const p = pct == null ? 0 : Math.max(0, Math.min(100, Math.round(pct)));
  const color =
    charging ? T.green : p <= 15 ? T.red : p <= 30 ? T.amber : T.blue;
  return (
    <View style={ui.battWrap}>
      <View style={ui.battTop}>
        <Text style={[ui.battPct, { color }]}>
          {pct == null ? '—' : `${p}%`}
          {charging ? '  ·  Charging' : ''}
          {lowPower ? '  ·  Low Power' : ''}
        </Text>
      </View>
      <View style={ui.battTrack}>
        <LinearGradient
          colors={
            charging
              ? ['#6EE7B7', '#34D399']
              : p <= 15
                ? ['#FCA5A5', '#F87171']
                : p <= 30
                  ? ['#FCD34D', '#FBBF24']
                  : ['#7DD3FC', '#38BDF8']
          }
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[ui.battFill, { width: `${pct == null ? 0 : p}%` }]}
        />
      </View>
    </View>
  );
}

export function Metric({ label, value, icon }) {
  return (
    <View style={ui.metric}>
      {icon ? <Text style={ui.metricIcon}>{icon}</Text> : null}
      <Text style={ui.metricVal} numberOfLines={2}>
        {value == null || value === '' ? '—' : String(value)}
      </Text>
      <Text style={ui.metricLbl} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export function Segmented({ tabs, value, onChange }) {
  return (
    <View style={ui.segTrack}>
      {tabs.map((t) => {
        const on = value === t.id;
        return (
          <SoftPress
            key={t.id}
            onPress={() => onChange(t.id)}
            style={[ui.segItem, on && ui.segItemOn]}
            haptic="light"
          >
            <Text style={[ui.segText, on && ui.segTextOn]}>{t.label}</Text>
          </SoftPress>
        );
      })}
    </View>
  );
}

export function AlertBanner({ title, body, tone = 'pink', meta }) {
  const accent =
    tone === 'red' ? T.red : tone === 'blue' ? T.blue : T.pink;
  return (
    <View style={[ui.alert, { borderColor: `${accent}55` }]}>
      <View style={[ui.alertBar, { backgroundColor: accent }]} />
      <View style={{ flex: 1 }}>
        <Text style={ui.alertTitle}>{title}</Text>
        {!!body && <Text style={ui.alertBody}>{body}</Text>}
        {!!meta && <Text style={ui.alertMeta}>{meta}</Text>}
      </View>
    </View>
  );
}

export function Field({ label, ...props }) {
  return (
    <View style={{ marginBottom: 14 }}>
      {!!label && <Text style={ui.fieldLabel}>{label}</Text>}
      <View style={ui.fieldBox}>
        <TextInputLike {...props} />
      </View>
    </View>
  );
}

// Avoid circular import of TextInput — re-export pattern
import { TextInput } from 'react-native';

function TextInputLike(props) {
  return (
    <TextInput
      placeholderTextColor={T.textDim}
      selectionColor={T.pink}
      {...props}
      style={[ui.fieldInput, props.style]}
    />
  );
}

export { TextInputLike as Input };

const ui = StyleSheet.create({
  btnWrap: { borderRadius: 14, overflow: 'hidden' },
  btnPrimary: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: T.pink,
        shadowOpacity: 0.35,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 },
      },
      android: { elevation: 4 },
    }),
  },
  btnPrimaryText: {
    color: '#1A0A12',
    fontWeight: '800',
    fontSize: 16,
    letterSpacing: 0.2,
  },
  btnGhost: {
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(244,114,182,0.55)',
    backgroundColor: 'rgba(244,114,182,0.06)',
  },
  btnGhostText: {
    color: T.pink,
    fontWeight: '700',
    fontSize: 15,
  },
  card: {
    backgroundColor: T.card,
    borderRadius: T.radiusLg,
    borderWidth: 1,
    borderColor: T.cardBorder,
    padding: 16,
    marginBottom: 12,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.25,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
      },
      android: { elevation: 3 },
    }),
  },
  sectionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionLabel: {
    color: T.text,
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    gap: 6,
  },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { fontSize: 12, fontWeight: '700' },
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  onlineDot: {
    position: 'absolute',
    borderWidth: 2,
  },
  avatarName: {
    color: T.textSecondary,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 4,
  },
  battWrap: { marginTop: 10 },
  battTop: { flexDirection: 'row', justifyContent: 'space-between' },
  battPct: { fontSize: 14, fontWeight: '800', marginBottom: 6 },
  battTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
  },
  battFill: { height: '100%', borderRadius: 999, minWidth: 4 },
  metric: {
    width: '33.33%',
    paddingHorizontal: 4,
    paddingVertical: 10,
  },
  metricIcon: { fontSize: 12, marginBottom: 2 },
  metricVal: {
    color: T.text,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  metricLbl: {
    color: T.textMuted,
    fontSize: 10,
    marginTop: 3,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  segTrack: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 14,
    padding: 4,
    borderWidth: 1,
    borderColor: T.cardBorder,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  segItem: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 11,
    alignItems: 'center',
  },
  segItemOn: {
    backgroundColor: T.pinkSoft,
    borderWidth: 1,
    borderColor: 'rgba(244,114,182,0.35)',
  },
  segText: {
    color: T.textMuted,
    fontSize: 13,
    fontWeight: '700',
  },
  segTextOn: { color: T.pink },
  alert: {
    flexDirection: 'row',
    backgroundColor: T.card,
    borderRadius: T.radius,
    borderWidth: 1,
    marginHorizontal: 16,
    marginBottom: 10,
    overflow: 'hidden',
    padding: 14,
    paddingLeft: 12,
  },
  alertBar: {
    width: 4,
    borderRadius: 4,
    marginRight: 12,
  },
  alertTitle: { color: T.text, fontWeight: '800', fontSize: 14 },
  alertBody: { color: T.textSecondary, marginTop: 4, lineHeight: 19, fontSize: 13 },
  alertMeta: { color: T.textMuted, marginTop: 6, fontSize: 11 },
  fieldLabel: {
    color: T.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 7,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  fieldBox: {
    backgroundColor: T.bgElevated,
    borderRadius: T.radiusSm,
    borderWidth: 1,
    borderColor: T.cardBorderStrong,
  },
  fieldInput: {
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 14 : 12,
    color: T.text,
    fontSize: 16,
    fontWeight: '500',
  },
});
