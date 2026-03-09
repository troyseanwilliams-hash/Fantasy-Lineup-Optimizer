import logoPath from "@assets/logo_no_bg.png";

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

interface BannerProps {
  height?: number;
  className?: string;
}

export function LogoBanner({ height = 40, className = "" }: BannerProps) {
  return (
    <img
      src={logoPath}
      alt="EliteLineup AI"
      className={`object-contain ${className}`}
      style={{ height }}
      data-testid="logo-banner"
    />
  );
}
