// source.mjs: the source interface and its per-run accounting (SPEC 1.1, 5.2). Adapters live in adapters/.
import { EoqlError } from './errors.mjs';

// Run accounting: what the ADAPTER delivered (mutant M12: entries_read comes from here, never from the result).
export class RunMeter {
  constructor() { this.bytes = 0; this.records = 0; this.ids = new Set(); this.files = new Set(); this.cache = new Map(); this.limits = null; this.onCharge = null; }
  charge(bytes, records) {
    this.bytes += bytes; this.records += records;
    if (this.onCharge) this.onCharge();
  }
  deliver(items) { for (const it of items) this.ids.add(it.e.id); }
}

export class Source {
  constructor(kind, uri) { this.kind = kind; this.uri = uri; this.meter = null; this.canResolve = true; this.writable = false; this.primary = false; }
  begin(meter) { this.meter = meter; }
  end() { this.meter = null; }
  get m() { if (!this.meter) this.meter = new RunMeter(); return this.meter; }
  // -> { items:[{e,file}], health:{corrupt:[], torn:[], files:[], extra:[]} }. memoized per run
  readAll() { throw new EoqlError('E_SOURCE_CAP', `${this.kind} cannot read`); }
  // entries at an address (and the retractions at it); adapters that cannot do better return a filtered full read
  region(addr, kinds) { const all = this.readAll(); return { items: all.items.filter((it) => it.e.addr === addr && (!kinds || kinds.includes(it.e.kind) || it.e.kind === 'retract')), health: all.health, regional: false }; }
  byId() { return undefined; }
  has(id) { return this.byId(id) !== undefined; }
  hasRegions() { return false; }
  close() {}
  describe() { return { kind: this.kind, uri: this.uri }; }
}
