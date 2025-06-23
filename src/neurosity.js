import { Neurosity } from "@neurosity/sdk";
import dotenv from "dotenv";

dotenv.config();

export const createNeurosity = (deviceId) => {
  return new Neurosity({ deviceId });
};

export const getHapticEffects = (neurosityInstance) => {
  return neurosityInstance.getHapticEffects();
};