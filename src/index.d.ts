/** `success` or `fail`, unless overridden */
type Status = 'success' | 'fail' | string;

export interface Context {
    /** The verb root for the workflow */
    verb: ['create' | 'get' | 'remove' | 'update' | string];
    namespace: string;
    relation: string;
    /** `success` or `fail`, unless overridden */
    status?: Status;
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
    Dispatch?<T>(data: T, context: Context): Promise<void>;
    steps?: object;
}

export interface TaskParameter<T> {
    data: T;
    /**Array of results for each of the prerequisites, in the same order as defined on the rule */
    prerequisiteResults: object[];
    context: Context;
    workflowStack: WorkflowStack[];
}

export interface Rule<T> {
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
    prerequisites: { context: Context; string?: object | function }[];
    logic(parameters: TaskParameter<T>): T;
    onError(parameters: { error: Error; data: T; context: Context; workflowStack: WorkflowStack[] }): T;
}
export type Rule = Rule<any>;

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
    execute<T>(data: T, context: Context): Promise<T>;
    execute<T>(data: T, workflow: Rule[], context: Context): Promise<T>;
    createWorkflow(context: Context): Promise<Rule[]>;
}
