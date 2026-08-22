const required = ["EXPO_TOKEN", "EAS_PROJECT_ID", "ASC_APP_ID"];
const missing = required.filter((name) => !process.env[name]);

if (missing.length > 0) {
  console.error(`Missing TestFlight configuration: ${missing.join(", ")}. See RELEASING.md.`);
  process.exit(1);
}

if (!/^\d+$/.test(process.env.ASC_APP_ID)) {
  console.error("ASC_APP_ID must be the numeric Apple ID from App Store Connect.");
  process.exit(1);
}

console.log("TestFlight configuration is present.");
