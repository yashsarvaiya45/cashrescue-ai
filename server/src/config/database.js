import mongoose from 'mongoose';

export async function connectDatabase(uri) {
  if (uri) {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5_000, socketTimeoutMS: 10_000 });
  }
}

export function databaseStatus(uri) {
  if (!uri) return 'disabled';
  return mongoose.connection.readyState === 1 ? 'connected' : 'unavailable';
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}
