import Svg, { Path, Circle, Rect } from "react-native-svg";

export function ShieldIcon({ size = 18, color = "#0b4a8f" }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4Z" stroke={color} strokeWidth="1.75" />
    </Svg>
  );
}

export function BellIcon({ size = 18, color = "#1a1a1a" }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 3v3M4 20h16L18 15a6 6 0 0 0-12 0Z" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M9.5 20a2.5 2.5 0 0 0 5 0" stroke={color} strokeWidth="1.75" strokeLinecap="round" />
    </Svg>
  );
}

export function WarnIcon({ size = 18, color = "#b45309" }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 3 2 20h20L12 3Z" stroke={color} strokeWidth="1.75" strokeLinejoin="round" />
      <Path d="M12 10v4M12 17h.01" stroke={color} strokeWidth="1.75" strokeLinecap="round" />
    </Svg>
  );
}

export function NavIconArrow({ size = 18, color = "#1a7a4c" }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M3 11l18-7-7 18-2.5-7.5L3 11Z" stroke={color} strokeWidth="1.75" strokeLinejoin="round" />
    </Svg>
  );
}

export function QRIcon({ size = 18, color = "#0b1f4f" }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="3" y="3" width="7" height="7" rx="1" stroke={color} strokeWidth="1.75" />
      <Rect x="14" y="3" width="7" height="7" rx="1" stroke={color} strokeWidth="1.75" />
      <Rect x="3" y="14" width="7" height="7" rx="1" stroke={color} strokeWidth="1.75" />
      <Path d="M14 14h3v3h-3zM19 14h2v2h-2zM14 19h2v2h-2zM19 19h2v2h-2z" fill={color} />
    </Svg>
  );
}

export function ClockIcon({ size = 18, color = "#b45309" }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.75" />
      <Path d="M12 7v5l3.5 2" stroke={color} strokeWidth="1.75" strokeLinecap="round" />
    </Svg>
  );
}

export function PinIcon({ size = 14, color = "#1a1a1a" }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 21s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12Z" stroke={color} strokeWidth="1.75" />
      <Circle cx="12" cy="9" r="2.25" stroke={color} strokeWidth="1.75" />
    </Svg>
  );
}

export function EyeIcon({ off, size = 18, color = "#666" }) {
  return off ? (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.24 4.24" stroke={color} strokeWidth="1.75" strokeLinecap="round" />
      <Path
        d="M6.5 6.7C4.4 8.1 2.9 10 2 12c1.6 3.6 5 7 10 7 1.8 0 3.4-.4 4.8-1.1M17.9 17.9C20 16.5 21.6 14.4 22 12c-1.2-2.7-3.5-5.4-7-6.6"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </Svg>
  ) : (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" stroke={color} strokeWidth="1.75" />
      <Circle cx="12" cy="12" r="3" stroke={color} strokeWidth="1.75" />
    </Svg>
  );
}

export function PhoneIcon({ size = 16, color = "#1a1a1a" }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6.5 3h3l1.5 4-2 1.5a12 12 0 0 0 6.5 6.5l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A17.5 17.5 0 0 1 4.5 5.2 2 2 0 0 1 6.5 3Z"
        stroke={color}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function ArrowRightIcon({ size = 16, color = "#fff" }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M5 12h14M13 6l6 6-6 6" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function BackIcon({ size = 16, color = "#1a1a1a" }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M15 6l-6 6 6 6" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function PlusIcon({ size = 16, color = "#0b4a8f" }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 5v14M5 12h14" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}
