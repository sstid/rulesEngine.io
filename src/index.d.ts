/** `success` or `fail`, unless overridden */
type Status = 'success' | 'fail' | string;

export interface Context {
    /** The verb root for the workflow */
    verb: 'create' | 'get' | 'remove' | 'update' | string;
    namespace: string;
    relation: string;
    /** `success` or `fail`, unless overridden */
    status?: Status;
    /** Optional routing criterion: `RulesArrayRepository.find` compares it against a rule's extra criteria (`defaultProviders/RulesArrayRepository.js:41-46`). Like `status`, it is stripped when a prerequisite workflow is compiled (`workflowGenerator.js:9,100,142`). */
    action?: string;
    featureFlags?: string[];
}

export interface WorkflowStack {
    /** tensed verb, e.g. `willCreate`, `doingUpdate`, `didRemove` */
    verb: string;
    namespace: string;
    relation: string;
    status?: Status;
    description: string;
    prerequisites?: WorkflowStack[];
    _ACTIVE?: boolean;
    _SKIPPED?: boolean;
    _ABORTED?: string;
}

export interface Settings {
    /** max cache age in milliseconds, default 5000ms */
    cacheAge?: number;
    /** Whether to include the workflow stack in calls to tasks and logging, default false */
    enableWorkflowStack?: boolean;
    /** Alternative states to use instead of ['success','fail'] */
    states?: [string, string];
    logging?: LoggingProvider;
    dispatch?<T>(data: T, context: Context): Promise<void>;
    steps?: object;
    /** Extra field names dropped when building a step's child context, on top of the built-in `onError`/`logic`/`prereqs`/`description`. Module-level state shared by every `RulesEngine` in the process — `setContextExcludedFields` appends to it (`contextProvider.js:18-21`). */
    contextExcludedFields?: string[];
}

export interface TaskParameter<T> {
    data: T;
    /**
     * Array of results for each of the prerequisites, in the same order as defined on the rule.
     * Always an array — `[]` when the rule declares no prerequisites, never `undefined` — so
     * positional destructuring without defaults is safe.
     */
    prerequisiteResults: object[];
    /**
     * The context this step runs under. Inside a prerequisite mini-workflow that is the
     * prerequisite's routing — including its declared base `verb`, the same way every step of a
     * `get` workflow sees `verb: 'get'` rather than its own tense.
     */
    context: Context;
    /**
     * The context of the step that DECLARED this prerequisite — the parent's routing, before the
     * prerequisite's own routing replaced it on `context`.
     *
     * Only present inside a prerequisite mini-workflow; `undefined` at the base level, where
     * `context` already is the parent routing. Reach for it when a callback must know which
     * collection the PARENT step is acting on: a rule that declares its own `namespace`/`relation`
     * can read those constants instead, but a WILDCARD rule has no constants to read.
     */
    parentContext?: Context;
    workflowStack: WorkflowStack[];
}

export interface WhenParameter {
    /**
     * The live message — NOT a deep clone (rule `logic` gets one, `when` does not, because it runs
     * on every message and must stay cheap). Treat as read-only: mutating it mutates the object the
     * caller passed to `execute`.
     */
    data: any;
    /** The prerequisite's routing context: the live request context merged with its declared routing. */
    context: Context;
    /**
     * The declaring step's context — the parent's routing. See `TaskParameter.parentContext`.
     */
    parentContext?: Context;
    /** The engine's dispatcher, the same one the rule's `logic` receives. */
    dispatch<T>(data: T, context: Context): Promise<void>;
    /** The engine's logger, the same one the rule's `logic` receives. */
    log: LoggingProvider;
}

/**
 * An `Error` the engine has flagged. Both flags are opt-in markers, absent on ordinary errors.
 */
export interface EngineError extends Error {
    /**
     * Set by the author (e.g. a `createAbortError` helper) to mean "stop gracefully, this is
     * expected control flow". In the main workflow: remaining steps are skipped, nothing is
     * dispatched, and `execute` RESOLVES to the `{ error }` output instead of rejecting. In a
     * prerequisite workflow: that prerequisite's result slot is `undefined` and the rule's `logic`
     * still runs — whether the abort came from one of the prerequisite's steps or from its `when`.
     */
    aborted?: boolean;
    /**
     * Set by the engine for a defect in how the workflow was built or cloned (today: a prerequisite
     * workflow with no `prereqContext`). Never routed to a step's `onError`, never converted into a
     * prerequisite result, never dispatched as a failure — it propagates out of `execute` from any
     * nesting depth.
     */
    isWiringError?: boolean;
}

/** A prerequisite as declared on a rule. */
export interface PrerequisiteDeclaration {
    /** Routing for the prerequisite sub-workflow. `verb` is required; omitted `namespace`/`relation` fall through to the parent. Absent `status`/`action` do NOT inherit the parent's. */
    context: Partial<Context> & { verb: string };
    /**
     * Optional gate, evaluated before the prerequisite workflow runs (before its transformation
     * too). Falsy → skipped, result slot `undefined`, rule logic still runs. `undefined` is the
     * only value that means "no gate" — a declared `null` is falsy and skips.
     * A throwing `when` yields an `{ error }` slot; the rule logic still runs. The exception is an
     * abort (`EngineError.aborted`), which skips with an `undefined` slot like every other abort.
     */
    when?: boolean | ((parameters: WhenParameter) => boolean | Promise<boolean>);
    [key: string]: unknown;
}

/**
 * A prerequisite compiled into a mini-workflow by `createWorkflow`, i.e. an array of steps carrying
 * the routing context that array executes under.
 */
export interface PrerequisiteWorkflow extends Array<Rule> {
    /**
     * Frozen. The prerequisite's declared context keys minus `status`/`action`, merged over the live
     * request context at execute time to route every step of this array. Its `namespace`/`relation`
     * win over a step's stale or parentward `originalContext`, and its `verb` is what every step
     * runs under — only the generated transformation step keeps `verb: 'TRANSFORMATION'`.
     * REQUIRED: the engine throws
     * `Prerequisite workflow is missing prereqContext.` rather than falling back to the parent
     * context, so anything that clones or rebuilds a compiled workflow must carry this property
     * across (lodash `cloneDeep` and `Array.prototype.map` both drop non-index array properties).
     */
    prereqContext: Partial<Context>;
    /**
     * The declared `when` gate, carried onto the compiled array. Same caveat as `prereqContext`:
     * anything that clones or rebuilds this array must copy it across, or the gate is silently
     * lost and the prerequisite always runs.
     */
    when?: PrerequisiteDeclaration['when'];
}

/** A rule after `createWorkflow` has compiled its prerequisites into mini-workflows. */
export interface CompiledRule<T = any> extends Omit<Rule<T>, 'prerequisites'> {
    prerequisites?: PrerequisiteWorkflow[];
}

export interface Rule<T = any> {
    /** tensed verb, e.g. `willCreate`, `doingUpdate`, `didRemove` */
    verb: string;
    namespace?: string;
    relation?: string;
    /** `success` or `fail`, unless overridden */
    status?: Status;
    description: string;
    featureFlag?: string;
    /** `priority` defines order of execution within a specific tense when using `rulesArrayRepository`. Higher priorities get run first. default 0 */
    priority?: number;
    prerequisites: PrerequisiteDeclaration[];
    logic(parameters: TaskParameter<T>): T;
    onError(parameters: { error: Error; data: T; context: Context; workflowStack: WorkflowStack[] }): T;
}

export interface LoggingProvider {
    debug(message: string, context: Context, workflowStack: WorkflowStack[]): void;
    info(message: string, context: Context, workflowStack: WorkflowStack[]): void;
    warn(warning: string, context: Context, workflowStack: WorkflowStack[]): void;
    error(error: Error, context: Context, workflowStack: WorkflowStack[]): void;
}

export interface RulesProvider {
    find(context: Context): Promise<Rule[]>;
}

export class RulesEngine {
    constructor(rules: Rule[] | RulesProvider, settings?: Settings);
    /**
     * Rejects if the workflow fails. On a graceful abort (a step threw an {@link EngineError} with
     * `aborted === true`) it RESOLVES to the workflow's `{ error }` output instead — check
     * `result?.error?.aborted` if you need to tell that apart from a completed workflow.
     */
    execute<T>(data: T, context: Context): Promise<T>;
    execute<T>(data: T, workflow: Rule[] | CompiledRule[], context: Context): Promise<T>;
    /** Steps with prerequisites come back as `CompiledRule`s — each prerequisite is a `PrerequisiteWorkflow` carrying its `prereqContext`. */
    createWorkflow(context: Context): Promise<CompiledRule[]>;
}
