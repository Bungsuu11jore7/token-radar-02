// Token Radar 02 — the "farming ROI velocity" model (radar-2).
//
// One sealed snapshot in, one ranked board out. The board covers every slug on the
// snapshot's watchlist (the floor, never the ceiling) and adds the early pre-token
// protocols below the floor that the velocity score picks, not the biggest TVLs.
//
// The value model uses only the snapshot's own figures. No protocol name is ever
// special-cased: the same four factors score every row, and the dashboard states
// the formula in full, including what the snapshot cannot say (it carries no
// testnet activity, no points program and no fundraising record, so the three
// signals below are proxies built from the figures it does carry, and the
// dashboard names them as proxies).
//
//   scale      = tvl_usd ^ 0.9 x 1.6            (a compressed scale: mid-size
//                                                growers count against giants)
//   momentum   = change_7d, clamped to [-60, +200]%, then a concave velocity
//                v in [-1, 1]:  v = sqrt(g/200) for g >= 0, -sqrt(-g/60) else
//                growthMult = 1 + 0.55 x v       (range 0.45 .. 1.55)
//   overdue    = how long the protocol has run with no token recorded.
//                A launch is most likely in a window, not at the start and not
//                never: a Gaussian hump centred at 700 days, width 500 days.
//                overdueMult = 0.80 + 0.45 x exp(-((age-700)/500)^2)
//   breadth    = chains the protocol runs on: 1 + 0.04 x min(chains-1, 8)
//   category   = a small prior by category family (points programs and
//                airdrops cluster in some families, bridges and staked products
//                rarely launch a token of their own): 0.92 .. 1.06, else 1.00
//   implied    = max(1, round(scale x growthMult x overdueMult x breadthMult
//                x categoryMult))
//
// The ROI velocity score (0..100, shown on the board) blends the same signals
// as a farming-priority read: 45% momentum, 30% overdue, 15% breadth, 10% scale.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  version: string;
  scale_exponent: number;
  scale_factor: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  overdue_center_days: number;
  overdue_width_days: number;
  overdue_floor: number;
  overdue_peak: number;
  breadth_per_chain: number;
  breadth_max_extra_chains: number;
  unknown_age_days: number;
  early_rows: number;
  live_rows: number;
}

export const MODEL: ModelConstants = {
  version: 'radar-2',
  scale_exponent: 0.9,
  scale_factor: 1.6,
  growth_weight: 0.55,
  growth_floor: -60,
  growth_cap: 200,
  overdue_center_days: 700,
  overdue_width_days: 500,
  overdue_floor: 0.8,
  overdue_peak: 0.45,
  breadth_per_chain: 0.04,
  breadth_max_extra_chains: 8,
  unknown_age_days: 365,
  early_rows: 200,
  live_rows: 24,
};

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  velocity: number;
  tge_label: string;
  tge_pct: number;
  model: {
    growth_pct: number;
    growth_multiplier: number;
    overdue_multiplier: number;
    breadth_multiplier: number;
    category_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  velocity: number;
  tge_label: string;
  tge_pct: number;
  growth_multiplier: number;
  overdue_multiplier: number;
  breadth_multiplier: number;
  category_multiplier: number;
  farm_steps: string[];
  watchlist: boolean;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** Whether a below-floor protocol belongs on the early radar: rankable. Bridges
 *  and staked products are not excluded — they score lower through the
 *  category prior instead (0.92–0.95), so the board stays full and honest
 *  about what they are. */
export function isEarlyEligible(p: SnapshotProtocol): boolean {
  return isRankable(p);
}

/** The category family's small prior: points programs and airdrops cluster in some families. */
const CATEGORY_PRIOR: Record<string, number> = {
  dexs: 1.06,
  lending: 1.05,
  derivatives: 1.06,
  yield: 1.04,
  'yield aggregator': 1.04,
  rwa: 1.03,
  'prediction market': 1.05,
  'liquidity manager': 1.04,
  'onchain capital allocator': 1.03,
  'risk curators': 1.03,
  bridge: 0.95,
  'canonical bridge': 0.95,
  'liquid staking': 0.92,
  'liquid restaking': 0.92,
  'restaked btc': 0.92,
};

export function categoryMultiplier(category: string | null): number {
  if (category === null) return 1;
  return CATEGORY_PRIOR[category.toLowerCase()] ?? 1;
}

/** The 7-day momentum as a concave velocity in [-1, 1]: big spikes count, but not linearly. */
export function growthVelocity(change7d: number | null, model: ModelConstants): { pct: number; velocity: number; mult: number } {
  const raw = finite(change7d, 0);
  const pct = Math.min(model.growth_cap, Math.max(model.growth_floor, raw));
  const velocity = pct >= 0 ? Math.sqrt(pct / model.growth_cap) : -Math.sqrt(-pct / -model.growth_floor);
  return { pct, velocity, mult: 1 + model.growth_weight * velocity };
}

/** The overdue factor: a launch is most likely inside a window around 700 days of running with no token. */
export function overdueMultiplier(age: number | null, model: ModelConstants): number {
  const a = age ?? model.unknown_age_days;
  const x = (a - model.overdue_center_days) / model.overdue_width_days;
  return model.overdue_floor + model.overdue_peak * Math.exp(-x * x);
}

/** The breadth factor: each extra chain up to 8 adds 4%. */
export function breadthMultiplier(chains: string[], model: ModelConstants): number {
  const extra = Math.min(Math.max(chains.length - 1, 0), model.breadth_max_extra_chains);
  return 1 + model.breadth_per_chain * extra;
}

/** The TGE clock: where the protocol sits in its launch window, as a label and a 0..100 meter. */
export function tgeClock(age: number | null, overdue: number, model: ModelConstants): { label: string; pct: number } {
  const pct = Math.round(Math.min(1, Math.max(0, (overdue - model.overdue_floor) / model.overdue_peak)) * 100);
  if (age === null) return { label: 'Unknown', pct };
  if (age < 180) return { label: 'Early', pct };
  if (age < 540) return { label: 'Building', pct };
  if (age < 900) return { label: 'Due window', pct };
  return { label: 'Overdue', pct };
}

/** The four factors and the implied value one protocol gets under the model. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { implied: number; growthPct: number; growthMult: number; overdueMult: number; breadthMult: number; categoryMult: number; age: number | null; growthVel: number } {
  const age = ageDays(asOf, protocol.listed_at);
  const g = growthVelocity(protocol.change_7d, model);
  const overdueMult = overdueMultiplier(age, model);
  const breadthMult = breadthMultiplier(protocol.chains, model);
  const categoryMult = categoryMultiplier(protocol.category);
  const scale = Math.pow(Math.max(protocol.tvl_usd, 1), model.scale_exponent) * model.scale_factor;
  const implied = Math.max(1, Math.round(scale * g.mult * overdueMult * breadthMult * categoryMult));
  return { implied, growthPct: g.pct, growthMult: g.mult, overdueMult, breadthMult, categoryMult, age, growthVel: g.velocity };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names is ranked.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the floor, picked by velocity score,
  // not by TVL — the radar exists to find growers early, not to re-list the biggest.
  // First score every eligible protocol so the velocity percentiles are the board's own.
  const earlyPool = snapshot.protocols.filter((p) => !chosen.has(p.slug) && isEarlyEligible(p) && p.tvl_usd < snapshot.floor_usd);
  const earlyScored = earlyPool.map((p) => ({ p, v: impliedValue(p, snapshot.as_of, model) }));
  const maxTvl = Math.max(...earlyScored.map((s) => s.p.tvl_usd), 1);
  const logSpan = Math.log10(maxTvl / 5_000_000);
  const velocityOf = (s: { p: SnapshotProtocol; v: ReturnType<typeof impliedValue> }): number => {
    const mom = (s.v.growthVel + 1) / 2;
    const over = (s.v.overdueMult - model.overdue_floor) / model.overdue_peak;
    const br = Math.min(Math.max(s.p.chains.length - 1, 0), model.breadth_max_extra_chains) / model.breadth_max_extra_chains;
    const sc = logSpan > 0 ? Math.log10(Math.max(s.p.tvl_usd, 5_000_000) / 5_000_000) / logSpan : 0;
    return Math.round(100 * (0.45 * mom + 0.3 * over + 0.15 * br + 0.1 * Math.min(1, Math.max(0, sc))));
  };
  earlyScored.sort((a, b) => velocityOf(b) - velocityOf(a) || b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : 1));
  for (const s of earlyScored.slice(0, model.early_rows)) chosen.set(s.p.slug, s.p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model);
    const clock = tgeClock(v.age, v.overdueMult, model);
    return { p, v, clock };
  });
  // Velocity needs the board's own TVL span, so it is computed after the board is chosen.
  const boardMaxTvl = Math.max(...scored.map((s) => s.p.tvl_usd), 1);
  const boardLogSpan = Math.log10(boardMaxTvl / 5_000_000);
  const velocityFor = (s: { p: SnapshotProtocol; v: ReturnType<typeof impliedValue> }): number => {
    const mom = (s.v.growthVel + 1) / 2;
    const over = (s.v.overdueMult - model.overdue_floor) / model.overdue_peak;
    const br = Math.min(Math.max(s.p.chains.length - 1, 0), model.breadth_max_extra_chains) / model.breadth_max_extra_chains;
    const sc = boardLogSpan > 0 ? Math.log10(Math.max(s.p.tvl_usd, 5_000_000) / 5_000_000) / boardLogSpan : 0;
    return Math.round(100 * (0.45 * mom + 0.3 * over + 0.15 * br + 0.1 * Math.min(1, Math.max(0, sc))));
  };
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    velocity: velocityFor(s),
    tge_label: s.clock.label,
    tge_pct: s.clock.pct,
    model: {
      growth_pct: s.v.growthPct,
      growth_multiplier: round4(s.v.growthMult),
      overdue_multiplier: round4(s.v.overdueMult),
      breadth_multiplier: round4(s.v.breadthMult),
      category_multiplier: round4(s.v.categoryMult),
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age, s.clock.label).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the TGE clock: an overdue launch may come soon, an early one needs patience. */
function holdDaysFor(tgeLabel: string): number {
  if (tgeLabel === 'Overdue') return 21;
  if (tgeLabel === 'Due window') return 30;
  if (tgeLabel === 'Building') return 45;
  return 60;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Lend $${capital} of USDC on ${name} (${chain}) and leave the supply earning.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain} and leave it earning fees.`;
  if (c.includes('bridge')) return `Move $${capital} of USDC across ${name} to ${chain}, then put the bridged funds to work in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} through ${name} and keep the staking receipt in the farm wallet.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Post $${capital} of USDC as margin on ${name} and open one small hedged trade.`;
  if (c.includes('prediction')) return `Back one market on ${name} with $${capital} and let the position settle.`;
  if (c.includes('curator') || c.includes('allocator')) return `Put $${capital} into a ${name} vault on ${chain} and hold the vault shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the yield-bearing asset ${name} issues on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and leave the position working.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is
 * derived from the protocol's own record (category, chains, TVL, TGE clock), never from
 * a hand-written list of names. It ends with an exit plan, because a farm that never
 * sells is a donation.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, tgeLabel: string): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(tgeLabel);
  const action = actionFor(p, capital, chain);
  return [
    {
      text: `Open ${p.name} from its DefiLlama page and confirm it still records no token and runs a points program, before you send anything.`,
      cost: 'nothing to check',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Do one qualifying action every week — a deposit, a swap, a borrow or a vote — so the wallet reads as active, not one-and-done.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Keep the position open for at least ${hold} days: the TGE clock reads ${tgeLabel.toLowerCase()}, so the qualifying window is ${hold} days.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Each month open the protocol's own points page with the farm wallet and record the points balance in your farm log.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes a month',
    },
    {
      text: `When the token launches, claim inside the claim window the protocol publishes, check any vesting schedule, and keep a small position for follow-on rewards.`,
      cost: 'claim gas only, about $3 to $10',
      time: '30 minutes on launch day',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, MODEL.live_rows)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow, watchlist: Set<string>): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    velocity: row.velocity,
    tge_label: row.tge_label,
    tge_pct: row.tge_pct,
    growth_multiplier: row.model.growth_multiplier,
    overdue_multiplier: row.model.overdue_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    category_multiplier: row.model.category_multiplier,
    farm_steps: row.farm_steps,
    watchlist: watchlist.has(row.slug),
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: model.version,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map((r) => radarRow(r, new Set(snapshot.watchlist))),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
