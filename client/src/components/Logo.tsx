import logoPath from "@assets/elitelineup-logo-v3.png";

interface LogoProps {
  size?: number;
  className?: string;
}

export function LogoIcon({ size = 32, className = "" }: LogoProps) {
  return (
    <img
      src={logoPath}
      alt="EliteLineup AI"
      className={`object-contain ${className}`}
      style={{ width: size, height: size }}
      data-testid="logo-icon"
    />
  );
}
