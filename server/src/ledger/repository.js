import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { ledgerSchema } from '../domain/ledger-input.js';
import { business, expenses, invoices } from '../../fixtures/synthetic-business.js';
import { unavailableLedger } from './errors.js';

const singletonId = 'cashrescue-ledger';

export function createDemoLedger() {
  const timestamp = new Date().toISOString();
  const timestamps = { createdAt: timestamp, updatedAt: timestamp };
  return ledgerSchema.parse({
    revision: randomUUID(),
    business,
    invoices: invoices.map(({ outstandingBalancePaise, ...invoice }) => ({
      ...invoice, receivedPaise: invoice.amountPaise - outstandingBalancePaise, ...timestamps,
    })),
    expenses: expenses.map((expense) => ({ ...expense, ...timestamps })),
  });
}

function createEmptyLedger() {
  const forecastStartDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Kolkata' }).format();
  return ledgerSchema.parse({
    revision: randomUUID(),
    business: { id: 'local-business', name: 'My business', currency: 'INR', openingBalancePaise: 0, forecastStartDate },
    invoices: [],
    expenses: [],
  });
}

export function createMemoryRepository(initial = createDemoLedger()) {
  let ledger = ledgerSchema.parse(initial);
  return {
    async read() { return structuredClone(ledger); },
    async replace(expectedRevision, next) {
      if (ledger.revision !== expectedRevision) return false;
      ledger = ledgerSchema.parse(next);
      return true;
    },
  };
}

const snapshotSchema = new mongoose.Schema({
  _id: String,
  snapshot: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
    validate: (value) => ledgerSchema.safeParse(value).success,
  },
}, { bufferCommands: false, versionKey: false });

export function createMongoRepository({
  connection = mongoose.connection,
  model = connection.models.CashRescueLedger ?? connection.model('CashRescueLedger', snapshotSchema),
} = {}) {
  async function query(operation) {
    if (connection.readyState !== 1) throw unavailableLedger();
    try {
      return await operation();
    } catch (error) {
      if (connection.readyState !== 1 || /(?:Network|Timeout|ServerSelection|NotConnected|PoolCleared)/.test(error.name)) {
        throw unavailableLedger();
      }
      throw error;
    }
  }

  return {
    async read() {
      const record = await query(async () => {
        const existing = await model.findById(singletonId).lean();
        if (existing) return existing;
        try {
          return await model.findOneAndUpdate(
            { _id: singletonId },
            { $setOnInsert: { snapshot: createEmptyLedger() } },
            { upsert: true, returnDocument: 'after', runValidators: true },
          ).lean();
        } catch (error) {
          if (error.code === 11000) return model.findById(singletonId).lean();
          throw error;
        }
      });
      return ledgerSchema.parse(record.snapshot);
    },
    async replace(expectedRevision, next) {
      const snapshot = ledgerSchema.parse(next);
      const result = await query(() => model.updateOne(
        { _id: singletonId, 'snapshot.revision': expectedRevision },
        { $set: { snapshot } },
        { runValidators: true },
      ));
      return result.matchedCount === 1;
    },
  };
}
