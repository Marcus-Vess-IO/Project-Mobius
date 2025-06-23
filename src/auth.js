export const verifyEnvs = (email, password, deviceId) => {
  const invalidEnv = (env) => {
    return env === "" || env === 0;
  };
  if (invalidEnv(email) || invalidEnv(password) || invalidEnv(deviceId)) {
    console.error(
      "Please verify deviceId, email and password are in .env file, quitting..."
    );
    process.exit(0);
  }
};

export const getCredentials = () => ({
  deviceId: process.env.DEVICE_ID || "",
  email: process.env.EMAIL || "",
  password: process.env.PASSWORD || ""
});