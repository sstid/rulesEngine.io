const taskShortName = task => {
    let verb = task.verb || 'transformation';
    let namespace = task.namespace || '{generic}';
    let relation = task.relation || '{generic}';
    let status = task.status || '';
    if (status && status.length > 0) {
        return `${verb}_${namespace}_${relation}_${status}`;
    }
    return `${verb}_${namespace}_${relation}`;
};

const taskName = task => `${taskShortName(task)} - ${task.description || ''}`;

/**
 * Recursively walk down the workflow, printing it out
 * @param {String} prefix current line beginning text
 * @param {Array} workflow current workflow or sub-workflow being printed
 * @param {String} postfix current line ending text
 * @param {Object} userContext
 * @returns {String} Returns a visual representation of the workflow
 * @example
 *─┐
 * ├─┐ willRemove_item_type  - Prevent deletion of item type when items exist with that type
 * │ ├── transformation_{generic}_{generic}  - Message transformation towards count_item_item
 * │ └── doingCount_{generic}_{generic}  - Perform the `count` operation on the database
 * ├── doingRemove_{generic}_{generic}  - Perform the `remove` operation on the database
 * ├─┐ didRemove_{generic}_{generic}  - Add an entry to the audit table
 * │ ├── transformation_{generic}_{generic}  - Message transformation towards create_item_type-patch
 * | ├─┐ willCreate_{generic}_{generic}  - Prevent creating duplicate records
 * │ │ ├── transformation_{generic}_{generic}  - Message transformation towards get_item_type-patch
 * │ │ └── doingGet_{generic}_{generic}  - Perform the `find` operation on the database
 * │ └── doingCreate_{generic}_{generic}  - Perform the `create` operation on the database
 */
function workflowToStringTree(prefix, workflow = [], postfix, userContext) {
    if (!workflow.length) return '- No Workflow Defined -';
    let result = '';
    if (!prefix) {
        result = `─┐ Workflow for ${taskName(userContext)}\n`;
    }

    workflow.forEach((task, tIndex) => {
        let marker;
        if (task.prerequisites && task.prerequisites.length) {
            marker = '├─┐';
        } else {
            if (tIndex === workflow.length - 1) marker = '└──';
            else marker = '├──';
        }
        result += `${prefix} ${marker} ${taskName(task)}${postfix ? ' - ' + postfix : ''}\n`;
        if (task.prerequisites) {
            task.prerequisites.forEach(preReq => {
                result += workflowToStringTree(prefix + ' │', preReq, postfix, userContext);
            });
        }
    });
    return result;
}

/**
 * Recursively walk down the workflow, constructing a simplified tree
 * @param {*} workflow
 * @example
 * [{
 *     name: 'willRemove_item_type',
 *     description: 'Prevent deletion of item type when items exist with that type',
 *     prerequisites: [
 *        {
 *            name: 'transformation_{generic}_{generic}',
 *            description: 'Message transformation towards count_item_item'
 *        },{
 *            name: 'doingCount_{generic}_{generic}',
 *            description: 'Perform the `count` operation on the database'
 *        }
 *     ]
 * },{
 *     name: 'doingRemove_{generic}_{generic}',
 *     description: 'Perform the `remove` operation on the database'
 * }{
 *     name: 'didRemove_{generic}_{generic}',
 *     description: 'Add an entry to the audit table',
 *     prerequisites: [
 *        {
 *            name: 'transformation_{generic}_{generic}',
 *            description: 'Message transformation towards create_item_type-patch'
 *        },{
 *            name: 'willCreate_{generic}_{generic}',
 *            description: 'Prevent creating duplicate records',
 *            prerequisites: [
 *                {
 *                    name: 'transformation_{generic}_{generic}',
 *                    description: 'Message transformation towards get_item_type-patch'
 *                },{
 *                    name: 'doingGet_{generic}_{generic}',
 *                    description: 'Perform the `find` operation on the database'
 *                }
 *            ]
 *        },{
 *            name: 'doingCreate_{generic}_{generic}',
 *            description: 'Perform the `create` operation on the database'
 *        }
 *     ]
 * }]
 */
function workflowToJSON(workflow) {
    return workflow.map(task => {
        let result = {
            name: taskShortName(task),
            description: task.description
        };
        if (task.prerequisites && task.prerequisites.length) {
            return {
                prerequisites: task.prerequisites.map(preReq => workflowToJSON(preReq)),
                ...result
            };
        }
        return result;
    });
}

module.exports = {
    workflowToString: (workflow, context) => workflowToStringTree('', workflow, '', context),
    workflowToJSON,
    taskToDescription: taskName,
    taskToShortName: taskShortName
};
