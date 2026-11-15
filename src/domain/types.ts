declare const brand: unique symbol;

type Brand<Base, Name extends string> = Base & { readonly [brand]: Name };

export type NonEmptyArray<T> = readonly [T, ...T[]];

export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export type ContractId = Brand<string, "ContractId">;
export type AmendmentId = Brand<string, "AmendmentId">;
export type ObligationId = Brand<string, "ObligationId">;
export type ClauseRef = Brand<string, "ClauseRef">;
export type Party = Brand<string, "Party">;
export type Actor = Brand<string, "Actor">;
export type Sha256Hex = Brand<string, "Sha256Hex">;
export type CalendarDate = Brand<string, "CalendarDate">;
export type Instant = Brand<string, "Instant">;
export type NormalizedText = Brand<string, "NormalizedText">;
export type TextOffset = Brand<number, "TextOffset">;
export type ObligationVersion = Brand<number, "ObligationVersion">;
export type PositiveCount = Brand<number, "PositiveCount">;
export type LeadDays = Brand<number, "LeadDays">;
export type DayOfMonth = Brand<number, "DayOfMonth">;
export type MonthDayOffset = DayOfMonth | Brand<number, "MonthDayFromEnd">;
export type EventSeq = Brand<number, "EventSeq">;

export const ID_LIMIT = 128;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const CALENDAR_DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const isId = (raw: string): boolean => raw.length <= ID_LIMIT && ID_PATTERN.test(raw);
const isLabel = (raw: string): boolean => raw.trim() !== "" && raw.length <= ID_LIMIT;
const isCount = (raw: number, least: number): boolean => Number.isSafeInteger(raw) && raw >= least;

export const isContractId = (raw: string): raw is ContractId => isId(raw);
export const isAmendmentId = (raw: string): raw is AmendmentId => isId(raw);
export const isObligationId = (raw: string): raw is ObligationId => isId(raw);
export const isClauseRef = (raw: string): raw is ClauseRef => isLabel(raw);
export const isParty = (raw: string): raw is Party => isLabel(raw);
export const isActor = (raw: string): raw is Actor => isLabel(raw);
export const isSha256Hex = (raw: string): raw is Sha256Hex => SHA256_PATTERN.test(raw);
export const isCalendarDate = (raw: string): raw is CalendarDate => {
  if (!CALENDAR_DATE_PATTERN.test(raw) || raw.startsWith("0000-")) return false;
  const date = new Date(`${raw}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === raw;
};
export const isInstant = (raw: string): raw is Instant => {
  if (!INSTANT_PATTERN.test(raw) || !isCalendarDate(raw.slice(0, 10))) return false;
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) && date.toISOString() === raw;
};
export const isTextOffset = (raw: number): raw is TextOffset => isCount(raw, 0);
export const isObligationVersion = (raw: number): raw is ObligationVersion => isCount(raw, 1);
export const isPositiveCount = (raw: number): raw is PositiveCount => isCount(raw, 1);
export const isLeadDays = (raw: number): raw is LeadDays => isCount(raw, 0);
export const isDayOfMonth = (raw: number): raw is DayOfMonth => isCount(raw, 1) && raw <= 31;
export const isMonthDayOffset = (raw: number): raw is MonthDayOffset =>
  Number.isSafeInteger(raw) && raw !== 0 && Math.abs(raw) <= 31;

export type SourceDocument = {
  readonly sourcePath: string;
  readonly sourceSha256: Sha256Hex;
  readonly textNormalized: NormalizedText;
};

export type Contract = SourceDocument & {
  readonly id: ContractId;
  readonly title: string;
  readonly party: Party;
  readonly effectiveFrom: CalendarDate;
  readonly effectiveTo: CalendarDate | null;
};

export type Amendment = SourceDocument & {
  readonly id: AmendmentId;
  readonly contractId: ContractId;
  readonly amendsClauseRef: ClauseRef;
  readonly effectiveFrom: CalendarDate;
};

export type QuoteSource =
  | { readonly kind: "contract"; readonly contractId: ContractId }
  | { readonly kind: "amendment"; readonly amendmentId: AmendmentId };

export type QuoteSpan = {
  readonly start: TextOffset;
  readonly end: TextOffset;
};

export type QuoteSpanError = "E_EMPTY_SPAN";

export const quoteSpan = (start: TextOffset, end: TextOffset): Result<QuoteSpan, QuoteSpanError> =>
  start < end ? ok({ start, end }) : err("E_EMPTY_SPAN");

export type UncheckedQuote = {
  readonly source: QuoteSource;
  readonly quote: string;
};

export type VerifiedQuote = {
  readonly source: QuoteSource;
  readonly quote: string;
  readonly span: QuoteSpan;
};

export type QuoteRejectionCode = "E_QUOTE_NOT_LITERAL" | "E_AMBIGUOUS_QUOTE";

export type QuoteRejection = {
  readonly code: QuoteRejectionCode;
  readonly why: string;
};

export type QuoteCheck = Result<VerifiedQuote, QuoteRejection>;

export const RECURRENCE_UNITS = ["day", "week", "month", "year"] as const;

export type RecurrenceUnit = (typeof RECURRENCE_UNITS)[number];

export const RRULE_FREQUENCIES = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"] as const;

export type RruleFrequency = (typeof RRULE_FREQUENCIES)[number];

export type Recurrence =
  | { readonly kind: "once"; readonly on: CalendarDate }
  | {
      readonly kind: "every";
      readonly interval: PositiveCount;
      readonly unit: RecurrenceUnit;
      readonly anchor: CalendarDate | null;
    }
  | {
      readonly kind: "rrule";
      readonly freq: RruleFrequency;
      readonly interval: PositiveCount;
      readonly byMonthDay: MonthDayOffset | null;
    };

export const once = (on: CalendarDate): Recurrence => ({ kind: "once", on });

export const every = (interval: PositiveCount, unit: RecurrenceUnit, anchor: CalendarDate | null): Recurrence => ({
  kind: "every",
  interval,
  unit,
  anchor,
});

export const rrule = (freq: RruleFrequency, interval: PositiveCount, byMonthDay: MonthDayOffset | null): Recurrence => ({
  kind: "rrule",
  freq,
  interval,
  byMonthDay,
});

export const OBLIGATION_TRANSITIONS = {
  proposed: ["verified", "rejected"],
  rejected: [],
  verified: ["active"],
  active: ["done", "superseded"],
  done: [],
  superseded: [],
} as const;

export type ObligationState = keyof typeof OBLIGATION_TRANSITIONS;

export type NextState<From extends ObligationState> = (typeof OBLIGATION_TRANSITIONS)[From][number];

export type ObligationTransition = {
  readonly [From in ObligationState]: { readonly from: From; readonly to: NextState<From> };
}[ObligationState];

export type ObligationTerms = {
  readonly id: ObligationId;
  readonly contractId: ContractId;
  readonly version: ObligationVersion;
  readonly party: Party;
  readonly summary: string;
  readonly clauseRef: ClauseRef;
  readonly recurrence: Recurrence;
  readonly leadDays: LeadDays;
  readonly effectiveFrom: CalendarDate;
};

export type Ending = {
  readonly endsOn: CalendarDate;
  readonly amendmentId: AmendmentId;
  readonly supersededBy: ObligationId | null;
};

export type ProposedObligation = ObligationTerms & {
  readonly state: "proposed";
  readonly quote: UncheckedQuote;
};

export type RejectedObligation = ObligationTerms & {
  readonly state: "rejected";
  readonly quote: UncheckedQuote;
  readonly rejection: QuoteRejection;
};

export type VerifiedObligation = ObligationTerms & {
  readonly state: "verified";
  readonly quote: VerifiedQuote;
};

export type ActiveObligation = ObligationTerms & {
  readonly state: "active";
  readonly quote: VerifiedQuote;
  readonly nextDue: CalendarDate;
  readonly ending: Ending | null;
};

export type DoneObligation = ObligationTerms & {
  readonly state: "done";
  readonly quote: VerifiedQuote;
  readonly ending: Ending | null;
};

export type SupersededObligation = ObligationTerms & {
  readonly state: "superseded";
  readonly quote: VerifiedQuote;
  readonly ending: Ending;
};

export type Obligation =
  | ProposedObligation
  | RejectedObligation
  | VerifiedObligation
  | ActiveObligation
  | DoneObligation
  | SupersededObligation;

export type AcceptedObligation = Exclude<Obligation, ProposedObligation | RejectedObligation>;

export type ObligationEvent = {
  readonly seq: EventSeq;
  readonly obligationId: ObligationId;
  readonly fromState: ObligationState | null;
  readonly toState: ObligationState;
  readonly at: Instant;
  readonly actor: Actor;
};

export type ObligationProposal = {
  readonly summary: string;
  readonly party: Party;
  readonly clauseRef: ClauseRef;
  readonly quote: string;
  readonly recurrence: Recurrence | null;
  readonly leadDays: LeadDays | null;
};

export type RejectedProposal = QuoteRejection & {
  readonly index: number;
};

export type ProposeOutcome = {
  readonly accepted: readonly VerifiedObligation[];
  readonly rejected: readonly RejectedProposal[];
};

export type TaskIdemKey = `contract:${ObligationId}:${CalendarDate}`;

export const taskIdemKey = (obligationId: ObligationId, dueOn: CalendarDate): TaskIdemKey =>
  `contract:${obligationId}:${dueOn}`;

export type DueItem = {
  readonly obligation: ActiveObligation;
  readonly dueOn: CalendarDate;
  readonly idemKey: TaskIdemKey;
};

export type ContractsErrorCode =
  | QuoteRejectionCode
  | "E_UNKNOWN_CONTRACT"
  | "E_UNKNOWN_OBLIGATION"
  | "E_BAD_RECURRENCE"
  | "E_TRANSITION"
  | "E_AMENDMENT_NOT_AFTER_START";
