# rulesEngine.io

Isomorphic JavaScript rules engine based on spoken language verb tenses.

[![Build Status](https://github.com/sstid/rulesEngine.io/workflows/CI/badge.svg?branch=master)](https://github.com/sstid/rulesEngine.io/actions)

-   [Features](#features)
-   [Definitions](#definitions)
-   [Notational Convention](#notational-convention)
-   [Installation](#installation)
-   [Basic Usage](#usage)
    -   [Default Step Configuration](#default-step-configuration)
    -   [Caching](#caching)
    -   [Pretty Print Workflow Plan](#pretty-print-workflow-plan)
-   [Configuration](#configuration)
    -   [Rules](#rules)
        -   [Conditions](#conditions)
        -   [Prerequisites](#prerequisites)
        -   [Logic](#rules-logic)
        -   [Error Handling](#error-handling)
    -   [Rules Provider](#rules-provider)
    -   [Logging Provider](#logging-provider)
        -   [Debugging (Workflow Stack)](#debugging-workflow-stack)
    -   [Dispatch Provider](#dispatch-provider)
        -   [Rabbit MQ](#rabbitmq)
        -   [React Redux](#react-redux)
    -   [Expanding Verb Support](#expanding-verb-support)
        -   [Anti-Patterns](#anti-patterns)
-   [Questions & Answers](#questions-and-answers)

---

## Features

-   Automatic runtime construction of hierarchical workflows.
-   Multi-tenant environment and feature flags compatible.
-   Asynchronous hooks on success and failure of operation
-   Implicit support for any form of storage, e.g. PostgreSQL, MySQL, MongoDB, Redis, etc.
-   Overridable strategy for logging.
-   Support for promises and async/await.
-   Complete Test Suite.
-   Caching for optimized workflow retrieval

---

## Definitions

<ul>

We will be using several terms throughout this library. For clarification, we will use the following definition of those terms:
| Term | Description |
| --- | --- |
| _Workflow_ | A (pre)defined set of tasks to be applied, in the defined order on its subject. |
| _Rules Engine_ | An automated means to evaluate criteria associated with (a collection of) rules at runtime, based on incoming data to select and apply the applicable tasks to that data. |
| _Task_ | A predefined amount of logic to be applied to data. |
| _Rule_ | A _task_ with criteria under which to execute it. |
| _Isomorphic_ | Executable/behaving the same in both browser, as well as a server-side (nodeJS) environments. |
| _spoken language verb tenses_ | Past, present/imperative, and future tense of a verb. Note, in the English language there is no real difference between a verb's present and future tense, so, we will combine the verbs with "will", "doing", and "did" prefixes to clearly distinguish the phases. |
| _Namespace_ | A grouping of related `relation`s. Used as an _isomorphic_ replacement instead of e.g. "database", or "domain". |
| _Relation_ | A specific "datatype" in whatever representation; Compare with e.g a MongoDB "Collection", a SQL "Schema", or a "class" or "data structure" in code. |

</ul>

---

## Notational Convention

<ul>
Throughout this document, and this library, you will see the following format used as shorthand to easily reference a particular state in a workflow:</br>
<code> {verb tense}\_{namespace}\_{relation}[\_{status}]</code></br>

-   `verb tense` should always be provided,
-   `namespace` and `relation` can be omitted,
-   `status`, is only added when applicable.

I.e.: `willCreate_item_type` is equivalent to <code> verb = "willCreate", namespace = "item", relation = "type"</code>,<br/> while `doingUpdate__` is equivalent to <code> verb = "doingUpdate", namespace = _any_, relation = _any_</code>. <br/>
Finally `remove___success` would reference the rules that should be run _asynchronously_ after any `remove` operation succeeds (independent of namespace or relation).

</ul>

---

## Installation

<ul>

```bash
npm install rulesEngine.io
```

To use it in the Browser or any other (non CJS) environment, use your favorite CJS bundler. No favorite yet? Try: Browserify, Webmake or Webpack.

</ul>

---

## Usage

<ul>

Below is a quick example how to use rulesEngine.io:

```javascript
const RulesEngine = require('rulesEngine.io');
const rulesArray = require('./yourLocalRulesArray');

const rulesEngine = new RulesEngine(rulesArray);

const context = {
    verb: 'doingGet',
    namespace: 'item',
    relation: 'type'
};

const output = await rulesEngine.execute({}, context);
```

In this example, the `RulesEngine` constructor takes one parameter:

1. An array of rules objects. See [Rules Format](#Rules)

Subsequently, `rulesEngine.execute` takes two parameters:

1. The request object. Passed into the selected tasks as is.
1. The _context_ object. Used to select the appropriate rules to apply to the request object.

Out of the box, rulesEngine.io comes with support for 4 verbs: _create_, _get_, _update_ and _delete_, and will therefore look for any rules in `rulesArray` for **willGet**, **doingGet**, and **didGet**.

### Default Step Configuration

<ul>
Out of the box rulesEngine.io supports the 4 CRUD operations, as well as _count_.

```Javascript
const steps = {
    get: ['willGet', 'doingGet', 'didGet'],
    create: ['willCreate', 'doingCreate', 'didCreate'],
    update: ['willUpdate', 'doingUpdate', 'didUpdate'],
    remove: ['willRemove', 'doingRemove', 'didRemove'],
    count: ['willCount', 'doingCount', 'didCount']
}
```

You can pass in support for additional verbs by passing in a similarly formatted object

```Javascript
const steps = {
    import: ['willImport', 'doingImport', 'didImport'],
    refresh: ['willRefresh', 'doingRefresh', 'didRefresh']
}

const RulesEngine = require('rulesEngine.io');
const rulesArray = require('./yourLocalRulesArray');

const rulesEngine = new RulesEngine(rulesArray, {steps});
```

The result is support for the _both_ the original, and the passed in steps.

</ul>

### Caching

<ul>

```javascript
const RulesEngine = require('rulesEngine.io');
const rulesArray = require('./yourLocalRulesArray');

const rulesEngine = new RulesEngine(rulesArray);

async function execute({ query, payload }, context) {
    //generate workflow using cached workflow if available
    const workflow = await rulesEngine.createWorkflow(context);
    // execute workflow
    const output = await rulesEngine.execute({ query, payload }, workflow, context);
}
```

### Pretty Print Workflow Plan

```JavaScript
async function execute(data, context){
    //pre-generate workflow using cached workflow if available
    const workflow = await rulesEngine.createWorkflow(context);
    // output JSON object:
    console.log(workflow.toJSON());
    //print multi-line plain text (e.g. for inclusion of plain text log files):
    console.log(workflow.toString());
    // ... execute workflow
}
```

</ul></ul>

---

## Configuration

<ul>
The `RulesEngine` constructor accepts 2 pieces of configuration

-   [Rules](#rules)
-   Settings

All settings are optional:
| Setting | Usage | default behavior |
|---|---|---|
| logging | Pass in a [Logging provider](#logging-provider) | logging to console |
| enableWorkflowStack | Enable provision of [Workflow Stack](#debugging-workflow-stack)| `false` |
| dispatch | Wire up [Dispatch provider](#dispatch-provider) | non-awaited promise call |
| steps | Add support for additional verbs | see [Default Step Configuration](#default-step-configuration) |
| states | Use [State identifier](#questions-and-answers) in your own language| `['success', 'fail' ]`|
| cacheAge | Duration to cache workflows in milliSeconds | 5000 ms |

</ul>

---

### Rules

<ul>

_"Rules"_ in rulesEngine.io are a combination of a set of conditions and logic. The conditions are evaluated from the [Rules Provider](#rules-provider), and to some extend included on the [workflowStack](#debugging-workflow-stack). However, after the initial construction of the workflow, it serves no functional purpose anymore. This allows 2 separate rule-styles:

1. Conditions and logic in one file
2. Conditions in a separate (query-able) source, with references to the logic files

While technically you could store the logic in a query-able resource as well, we strongly recommend against storing code in a database as e.g. strings and interpreting those strings as code and executing the result.

In the examples provided, we will combine conditions and logic as if in 1 file, but as stated, they can be separated.

#### Example Rule

```JavaScript
{
    verb: 'willCreate',
    namespace: undefined,
    relation: undefined,
    status: undefined,
    description: 'Prevent the creation of the record if one already exists with the same `title` property.'
    // obtain any additional info needed to perform the logic
    prerequisites:[{
        context:{
            verb:'count',
            namespace: undefined,
            relation: undefined,
            status: undefined,
        }
        query: ({data:{query, payload}, context}) => {
            return { title: payload.title };
        },
        payload:undefined
    }],
    //this is the actual logic:
    logic: async ({data:{query, payload}, prerequisiteResults, context, workflowStack}) => {
        const [countResult] = prerequisiteResults;
        if (countResult > 0){
            throw new Error('Duplicate Exception');
        }
        return {query, payload};
    }
}
```

The `undefined` values are for clarity of the example, in reality the properties can be omitted entirely.

#### Conditions

<ul>
By default, rulesEngine.io assumes 4 standard condition properties: `verb`, `namespace`, `relation`, `status`. In addition, the `rulesArrayRepository` Rules Provider is built with support to include (and therefore, by the absence of the feature flag on the context: exclude) rules by setting a `featureFlag` property on the rule, and have a `featureFlags` array of strings on the context. If, and only if the rule's featureFlag value is also included in the context's featureFlag array, then it will be included in the workflow.

Finally, _any_ other property that is passed in on the context will be compared to the rule's value for that same property, if that property also exists with a non-`undefined` value on the rule.

The idea behind this approach is that, beyond the basic verb-based workflow construction, it allows for a versatile inclusion/exclusion mechanism by any other property. Examples could be general concepts as a tenantId, or as specific as e.g. specific properties of the data. It is completely controlled by you in what you pass in as _"context"_ to `rulesEngine.createWorkflow(context)` or `rulesEngine.execute(data, workflow, context)`.

Note: If you need any more advanced rule selection mechanisms: it is only limited by your own creativity if you implement your own [Rules Provider](#rules-provider).

</ul>

#### Prerequisites

<ul>
Often, before you can do some specific operation on the incoming data, you need some more information from the system. E.g. you might want to put in duplicate prevention before you `create` an item. _IF_ you would have a `count`<sup>[1](#footnote1)</sup> of the number of records with that particular value, it would be very easy to implement a rule that checks if the count is 0, and if not, throws an exception. In rulesEngine.io this is implemented through `prerequisites`. [See also the Example Rule above.](#example-rule). When rulesEngine.io builds the workflow, after the initial build, it will check all included rules for prerequisites, and for each prerequisite, it will build an addition (embedded) workflow, that is executed before the actual rule is executed. All rules included in those embedded workflows are then checked for prerequisites, etc, to a maximum depth of 10 iterations.

<a name="footnote1"><sup>1</sup></a> In your particular system it may or may not be more efficient to do a `get` and check if anything is returned.</br>

A _prerequisite_ is an object with at least a `context`:

-   `context` - This object is required. It has the following properties itself:
    -   `verb` - Required. One of the base verbs. E.g. _count_, or _get_, but never one of the _future_ or _past_ tense forms.
    -   `namespace` - Optional. If empty, the original request's namespace will be used.
    -   `relation` - Optional. If empty, the original request's relation will be used.
    -   `status` - Optional. If absent will _NOT_ use the original request's relation will be used.

Any other properties are optional, and control what is passed into the actual prerequisite workflow. They can either be a fixed value, or a function receiving the data and (parent) context.

For Example:

```JavaScript
 {
   //...
   prerequisites: [{
        context:{
            verb: 'update',
            namespace: 'devices',
            relation: 'iotDevice'
        },
        query:({data, context})=>{ return {_id:data._id}; },
        payload:[{op:'replace', path:'/online', value:true}]
   }]
   logic: async (...) => {...}
 }
```

with the following `data` object:

```JSON
{
    "_id":"2001"
}
```

will result in the following object that is passed into the _update_devices_iotDevice_ workflow as `data`:

```JSON
{
    "query":{"_id":"2001"},
    "payload":[{"op":"replace", "path":"/online", "value":true}]
}
```

##### Aborting a prerequisite workflow

<ul>
If an exception is thrown in a prerequisite workflow, it will be logged as reason for aborting the prerequisite workflow, and `undefined` will be passed to the associated workflow as the result for that prerequisite. Throwing an error from a prerequisite workflow will NOT abort the main workflow.
</ul></ul>

#### Rules logic

<ul>
Rules, or specifically _tasks_ in rulesEngine.io is where the logic happens. For real: Each rule has a `logic` method that implements the functional logic for that task.

```JavaScript
 {
   //...
   /**
    * @param {object} parameters
    * @param {any} parameters.data the data object to work on
    * @param {any[]} parameters.prerequisiteResults Array of resulting objects from each prerequisite, or an empty array if there were none.
    * @param {Context} parameters.context the context for the current request
    * @param {WorkflowStack} [parameters.workflowStack] for debugging only, the workflowStack as applicable at the start of executing `logic()` I.e. the current rule is marked with _ACTIVE, if enabled.
    * @param {(data:object,context:Context)=>Promise<void>} parameters.dispatch the dispatch function to emit events
    * @param {LoggingProvider} parameters.log Logging object to output your logging needs
    **/
   logic: async ({data, prerequisiteResults, context, workflowStack, dispatch, log}) => {
        const [countResult] = prerequisiteResults;
        if (countResult > 0){
            throw new Error('Duplicate Exception');
        }
        const output = data;
        return output;
    }
 }
```

During execution, the `logic` method is passed 5 or 6 parameters:

-   `data` - This is the the data you passed in to the `execute()` method, after all previous tasks (if any) have been applied to it. If this is a task in a prerequisite workflow, this includes any transformations as defined on the prerequisite definition of the parent rule.
-   `prerequisiteResults` - a (possibly empty) array with the results from all prerequisites workflows, in the same order as they are defined on the `prerequisites`.
-   `context` - the `context` as passed into `execute()`, or, in case of a prerequisite workflow, as constructed in the prerequisite definition.
-   `workflowStack` - _If_ [enabled](#debugging-workflow-stack), the workflowStack.
-   `dispatch` - the [dispatch function](#logging-provider) to emit events
-   `log` - [Logging object](#dispatch-provider) to output your logging needs

##### Aborting a workflow

<ul>
If an exception is thrown in the main workflow, it will abort the workflow, and trigger a `___fail` workflow for the given verb, namespace and relation, unless the aborted workflow was already a `___success` or `___fail` one.
</ul></ul>

#### Error Handling

Sometimes, when an error is thrown in the rules logic, it makes sense to perform some error handling right on the spot (rather than in a `__fail` rule). Either because recovery is possible, or because you need to undo some thing done in that rule's logic.
rulesEngine.io allows defining an `onError` method on a rule to perform either tasks:

```JavaScript
 {
   //...
   /**
    * @param {object} parameters
    * @param {Error} parameters.error the error object throw in `logic()`
    * @param {any} parameters.data the data object as passed into `logic()`
    * @param {Context} parameters.context the context object as passed into `logic()`
    * @param {WorkflowStack} [parameters.workflowStack] for debugging only, the workflowStack as applicable at the start of`logic()` I.e. the current rule is marked with _ACTIVE, if enabled
    * @param {(data:object,context:object)=>Promise<void>} parameters.dispatch the dispatch function to emit events
    * @param {LoggingProvider} parameters.log Logging object to output your logging needs
    **/
   onError: async ({error, data, context, workflowStack, dispatch, log}) => {
        if (error.message.includes('Warning')){
            //recovery possible, or error can be ignored, return a result for the next rule to continue with.
            const output = data;
            return output;
        }
        //no recovery possible, rethrow original error (or throw a new one)
        throw new Error('Non Recoverable State');
    }
 }
```

Unlike `logic()` which does not _need_ to return a result, `onError()` needs to either throw or re-throw an error, or return a result. If nothing is returned, rulesEngine.io will throw an error and abort the workflow, to guarantee proper thought has been put into the error handling

## </ul></ul>

### Rules Provider

<ul>
Without rules, a rules engine is nothing. Rules can be provided to ruleEngine.js in 2 ways. As array or rules objects, or through a rules provider that can use arbitrary logic to query whatever source you'd like. All you need to do is implement a `find` method similar to this:

```Javascript
// rulesRepository.js

module.exports = {
  /**
   * @param {object} context the context object as passed into `rulesEngine.execute`
   * @param {string} context.verb the verb tense to retrieve rules for
   * @param {string} context.namespace
   * @param {string} context.relation
   * @param {string} [context.status]
   * ... any other property you provide on the context object, examples could be tenant, user,
   */
  async find: ({verb, namespace, relation, status, ...context}) => {
      //... perform your own logic to retrieve and filter rules.
      //E.g. query a database for a list of applicable rules, then retrieve the rules from the file system
  }

}
```

```Javascript
const RulesEngine = require('rulesEngine.io');
const rulesRepository = require('./rulesRepository');

const rulesEngine = new RulesEngine(rulesRepository);
```

</ul>

---

### Logging Provider

<ul>
Without additional configuration, rulesEngine.io will log to the console. Alternatively, it is possible to provide your own logging provider through the `RulesEngine` constructor configuration. This provider should expose some or all of the following interfaces:

Logging provider template:

```Javascript
// logging.js
module.exports = {
  /**
  * Called with detailed debugging information
  * @param {string | object} message
  * @param {object} context
  * @param {object} [workflowStack] workflow Stack, if enabled
  */
  debug: (message, context, workflowStack) => console.log(message),

  /**
  *
  * @param {string} message
  * @param {object} context
  * @param {object} [workflowStack] workflow Stack, if enabled
  */
  info: (message, context, workflowStack) =>  console.info(message),

  /**
  * Called for logging expected error conditions
  * @param {string} warning
  * @param {object} context
  * @param {object} [workflowStack] workflow Stack, if enabled
  */
  warn: (warning, context, workflowStack) =>  console.warn(warning),

  /**
  * Called for unhandled errors.
  * @param {Error} error Javascript Error object. Note: this object is not serializable by default
  * @param {string} error.message
  * @param {string} error.stack
  * @param {object} context
  * @param {object} [workflowStack] workflow Stack, if enabled
  */
  error: (error, context, workflowStack) => console.error(error),
}

```

```Javascript
const RulesEngine = require('rulesEngine.io');
const logging = require('./logging');

const rulesEngine = new RulesEngine(rules, { logging });
```

If a logging provider is specified, any non-implemented log levels will default to log to the console as depicted above.

#### Debugging (Workflow Stack)

<ul>
It is possible to enable tracking the workflow stack for debugging purposes. When enabled, it will be included as a 3rd parameter on logging calls, as well as added as an extra parameter to the rule logic invocations. (See also [Rules](#rules).)

To enabled it, set the `enableWorkflowStack` parameter on the configuration to true:

```Javascript
const rulesEngine = new RulesEngine(rules, { enableWorkflowStack:true });
```

When enabled, rules will get called with an additional `workflowStack` parameter available for logging or inspecting during debugging. Additionally, logging from rulesEngine.io itself will include the workflow stack.

The `workflowStack` is a JSON object, including key information about the constructed workflow, as well as the progress through that workflow.

**Example**
The following is example output of a workflow stack

```JSON
[
    // first task
  {
    "verb": "doingGet",
    "description": "Perform the `find` operation on the database",
    //this task was executed, and this was the value returned by this task.
    //As such, this value is what was used as payload for the second task, as well as for that task's prerequisites
    "RESULT": [
      {
       //... some result
      }
    ]
  },
  // second task
  {
    "verb": "didGet",
    "namespace": "deviceManagement",
    "relation": "settings",
    "description": "Assure existence of settings record",
    "prerequisites": [
      [
        {
          "TRANSFORMATIONRESULT": "pending",
          "description": "Message transformation towards create_deviceManagement_settings ",
          "_ABORTED": "Settings Exists. No need to create."  //The transformation step aborted the rest of this sub-workflow
        },
        {
          "verb": "willCreate",
          "namespace": "deviceManagement",
          "relation": "settings",
          "description": "Prevent creating 2nd global settings",
          "_SKIPPED": true  // this task was never executed as an earlier step aborted the (sub) workflow
        },
        {
          "verb": "doingCreate",
          "description": "Perform the `create` operation on the database",
          "_SKIPPED": true  // this task was never executed as an earlier step aborted the (sub) workflow
        }
      ]
    ],
    "_ACTIVE": true  // This stack was generated entering THIS rule
  }
]
```

</ul></ul>

---

### Dispatch Provider

<ul>
By default, rulesEngine.io will execute asynchronous (success/fail) rules by recursively calling itself without awaiting the result. This will work for simple, light weight applications. However, when the code or the environment becomes more complex, it is possible, and recommended, to provide your own dispatching or queueing mechanism.
<br/><br/>

#### RabbitMQ

<ul>
On server environments, we recommend using a message queue like [RabbitMQ](https://www.rabbitmq.com/) to queue messages going into the rulesEngine. There are many libraries to post to RabbitMQ. In this example we use [foo-foo-mq](https://www.npmjs.com/package/foo-foo-mq):

```JavaScript
const rabbit = require('foo-foo-mq');
// ... rabbit configuration omitted for brevity

const dispatch = async (message, context) => rabbit.publish('rulesEngine.exchange', {message, context});

const rulesEngine = new RulesEngine(rules, { dispatch });

```

</ul>

#### React Redux

<ul>
On the client several frameworks provide their own mechanisms to recurse. rulesEngine.io can fully take advantage from that by making it use their dispatch. The following example shows how to hook up a React Redux Action:

```JavaScript
function someAction(store, action, next){
    const rulesEngine = new RulesEngine(rules, { dispatch: store.dispatch });
    const context = ...
    const output = await rulesEngine.execute(action, context);
    return next(output);
}

module.exports = closeAction;
```

</ul></ul>

---

### Expanding Verb Support

<ul>
By default, rulesEngine.io comes with built-in verb support for the the basic CRUD operations. However, it is possible to expand on, and even override those. rulesEngine.io uses a mapping of an incoming _verb_ to a sequence of phases or steps. By convention, those steps are different tenses of the verb. Using this pattern, you can provide your own steps to the `RulesEngine` constructor configuration:

```Javascript
const steps = {
    import: ['willImport', 'doingImport','didImport'],
    heartbeat: ['heartbeat']
};

const rulesEngine = new RulesEngine(rules, { steps });
```

Any rules mappings defined this way will be combined with the standard operations, with any mappings you provide taking replacing the default ones if applicable.

Note: like _heartbeat_ in the above example, it is possible to define less than 3 steps for a verb. While there might be exceptions where you know you will never use a before and after phase, generally this should be avoided as it prevents easy extensions in the future. (If you are worried about performance when you have a slow rules provider, use `rulesEngine.createWorkflow` to take advantage of its caching abilities).

#### Anti-Patterns

<ul>
While technically it is possible to define more steps, and rulesEngine.io will incorporate all steps into a single(synchronous) workflow, this should be considered an anti-pattern. Limiting ourselves to using just the 3 indicated verb tenses promotes generic re-usable and composable rules.</br>
Consider the following configuration:

```Javascript
const steps = {
    import: ['splitInBatches', 'validateValues', 'createDependencies', 'import', 'upsertImportRecord'],
};
```

The steps in this configuration are very specific, and predefine the complete workflow, completely bypassing the flexibility of the rules engine.

Another likely code-smell is [having more than 1 rule for the `present` tense](#question-can-i-have-more-than-1-rule-for-the-present-tense).

</ul></ul></ul>

---

## Questions and Answers

<ul>

### **Question: Why are you use spoken language verb tenses?**

<ol type="A"><li> Code is written and maintained by humans. Humans understand, and "are standardized" on the spoken language at a much more natural level than any arbitrary encoding scheme could facilitate. Additionally, the spoken language has "support" for practically any operation we can think of. So, why re-invent the wheel?
</li></ol>

### **Question: What logic should I implement for each verb tense?**

<ol type="A"><li> This is totally open for you to decide on. In general, each rule should be as specific (have a single-response) as possible. What has worked for us is to use the following:

| Verb Tense                                 | Usage                                                                                                                                                                                                            | CRUD examples                                                                                                            |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `present`/`imperative`</br> (doing + verb) | Only the _core_ operation the verb indicates<sup>[2](#footnote2)</sup>. E.g. the actual operation on the database, or the actual http call. Typically we only have 1 rule per namespace/relation for this tense. | doingCreate, doingGet, doingupdate, doingDelete                                                                          |
| `future` (will + verb)                     | Anything you might want to do in preparation for doing the actual operation. E.g. validation, adding timestamps, etc                                                                                             | willCreating, willGet, willUpdate, willDelete                                                                            |
| `past` (did + verb)                        | Anything you want to do synchronously after the actual operation has completed. E.g. adding computed or default values before the value is returned to the client.                                               | didCreate, didGet, didUpdate, didDelete                                                                                  |
| verb\_\_\_success                          | Any logic to run asynchronously from the original request upon successfully executing the original request. E.g. sending a welcome email when a new user account is created.                                     | create\_\_\_success,<br/> update\_\_\_success,<br/> get\_\_\_success<sup>[3](#footnote3)</sup>,<br/> delete\_\_\_success |
| verb\_\_\_fail                             | Any logic to run asynchronously from the original request when that original request failed to execute. E.g.                                                                                                     | create\_\_\_fail,<br/> update\_\_\_fail,<br/> get\_\_fail<sup>[3](#footnote3)</sup>,<br/> delete\_\_\_fail               |

<a name="footnote2"><sup>2</sup></a> Keeping the `present` logic as generic, simple, and single-responsible as possible will help drive reuse and simplicity.</br>
<a name="footnote3"><sup>3</sup></a> _get\_\_\_success_ and _get\_\_\_fail_ will rarely have implementations. Examples would be very specific logic for e.g. failing or succeeding in retrieving a user for login, for audit/tracking purposes.

</li></ol>

### **Question: Can I have more than 1 rule for the present tense?**

<ol type="A"><li> Technically: absolutely. Practically you might not really want to do that though. Just look at the verb you are implementing. The present tense is where you _do the verb's action_. Do you really need multiple rules to accomplish that? If so, are you sure you are not doing multiple things? (E.g. save something, AND update it's dependencies)

If you are doing multiple things, look at the _primary_ thing you are doing ("save something"), and put that in the present-tense rule. Then look at the secondary action ("update it's dependencies"). If that fails, should the primary action still fail? If so, put it in a past-tense ( `did{verb}` ) rule. If not, trigger it from a `{verb}__success` rule.

Note, if you would need to roll-back the primary action if the secondary action fails, you _could_ put the secondary action in the past-tense (`did{verb}`) rule. However, if the request came from a client that is waiting for a response, it might be better to just return the result from the primary action, then trigger the secondary action(s) from the `{verb}__success` rule, and IF the secondary actions fail, trigger a new update to roll back the primary action. It will be much easier to debug, and (if applicable) it load-balances better.

</li></ol>

### **Question: I have a `deploy` verb, and need to do multiple actions during our deployment. Can I have multiple rules for the present tense (`doing{verb}`)?**

<ol type="A"><li> Technically, yes. But what are those "multiple actions"? maybe something like

-   run database migrations
-   deploy code
-   run regression test suite

If so, you might want to introduce a `migrate` verb, and have a `willDeploy__` rule with that as the prerequisite, and a `regress` verb that you dispatch from a `deploy__success` rule.

</li></ol>

### **Question: I like the tool, but we do everything in our code in .... (fill in your own native language). Can we use verb tenses in our language?**

<ol type="A"><li>  Yes. See [Expanding Verb Support](#expanding-verb-support), and provide the verb tenses in your own language. E.g. the following would configure the basic verbs in Dutch:

```JavaScript
const steps = {
    creeer: ['gaatCreeren', 'creeer','gecreerd'],
    vind: ['gaatVinden', 'vind','gevonden'],
    verander: ['gaatVeranderen', 'verander', 'verandered'],
    verwijder: ['gaatVerwijderen', 'verwijder', 'verwijderd']
};

const rulesEngine = new RulesEngine(rules, {steps});
```

Just make sure to match the `verb` properties on your rules with your the step names as you configure in the options

</li></ol>

### **Question: I don't want "success" and "fail", I want the spanish "exito" and "fallar".**

<ol type="A"><li>  That is not a question, but a comment. However you can customize the states as well:

```JavaScript
const estado = ['exito', 'fallar']

const motorDeReglas = new RulesEngine(rules, {states:estado});
// without any further configuration, this will result in e.g. `create_item_type_exito`
```

Just make sure to have the "success" state first, and the "fail" state second.

</li></ol>

### **Question: Where should I implement creating a patch record, in a 2nd rule in `doingCreate`, the `did{verb}` or in the `{verb}__success`?**

<ol type="A"><li> That is a very good question, and the answer might be different based on performance requirements and other tolerances. For us, we implemented the patch record creation at a lower level as a unary action directly tied to the the record creation itself. This allows us to think more about business logic in the rules, and not worry about implementation details like patch record creation.
</li></ol>

### **Question: You seem rather specific about what goes in each verb-tense, why??**

<ol type="A"><li>  Of course, you should organize your code as you like. The recommendations in this library are based on our experiences of what has helped us to keep the workflows small, which in turns helps with debugging (less things going on) and load balancing (multiple short workflows that don't tie up a server). It also helps with keeping the individual rules more in line with many coding principles, and therefore more maintainable in general:

-   Single Responsibility - keeping rules small forces you to keep the number of things you do in them limited
-   Open Closed - it is easy to add new rules without interfering with other rules if they all only do a very specific thing
-   DRY - it is easy to re-use small rules. When rules become more complex, they often also become harder to re-use
-   KISS - just keep it simple...

And perhaps most of all, it intentionally forces you as developer to think about how you should break up functionality, before you begin. Pausing a moment and thinking about _what_ you are now exactly going to code, before starting to code is usually a good thing...

</li></ol>
</ul>
