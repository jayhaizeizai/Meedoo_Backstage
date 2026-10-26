import { supportedPlatforms, type SocialPlatform } from "./social-platforms";

// Server runtime flags; never bundle environment access into browser code.
export function getEnabledPlatforms(): SocialPlatform[] {
  return supportedPlatforms.filter((platform) => {
    const value =
      process.env[`MEEDOO_PLATFORM_${platform.toUpperCase()}_ENABLED`];
    if (value === undefined) return platform !== "threads";
    return ["true", "1", "on"].includes(value.trim().toLowerCase());
  });
}

export function platformSelectionEnabled(platforms: readonly string[]) {
  const enabled = getEnabledPlatforms();
  return (
    enabled.length > 0 &&
    enabled.length === platforms.length &&
    enabled.every((platform) => platforms.includes(platform))
  );
}
