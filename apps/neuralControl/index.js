import { createNeurosity, getHapticEffects } from '../../src/neurosity.js';
import { verifyEnvs, getCredentials } from '../../src/auth.js';
import { setupGracefulExit } from '../../src/gracefulExit.js';

// Authentication and device setup
const { deviceId, email, password } = getCredentials();
verifyEnvs(email, password, deviceId);

// Instantiate Neurosity client
const neurosity = createNeurosity(deviceId);
const effects = getHapticEffects(neurosity);

const main = async () => {
  await neurosity.login({ email, password });
  console.log("Logged in. Waiting for Kinesis predictions...");

  neurosity.kinesis("leftHandPinch").subscribe((intent) => {
  console.log("Hello World!");
  });

};

main(); 