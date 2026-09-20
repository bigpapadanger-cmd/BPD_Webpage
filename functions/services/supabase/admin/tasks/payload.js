// Canonical Taskboard contract: mirrors the existing admin.tasks model.
const FIELDS = new Set(["title", "body", "priority", "responsible_roles", "timeline_days"]);
const ROLES = new Set(["owner", "database", "security", "ui"]);
export function taskInputError(code, message) {
    return Object.assign(new Error(message), { code, status: 400 });
}
export function normalizeTaskPayload(input, partial = false) {
    if (!input || typeof input !== "object" || Array.isArray(input) || !Object.keys(input).length)
        throw taskInputError("TASK_INPUT_INVALID", "A task object is required.");
    if (Object.keys(input).some(key => !FIELDS.has(key)))
        throw taskInputError("TASK_FIELDS_UNSUPPORTED", "Unsupported task fields were supplied.");
    const result = {};
    for (const key of FIELDS) {
        if (!(key in input)) {
            if (!partial) throw taskInputError("TASK_INPUT_INVALID", "Title, body, priority, responsible roles, and timeline days are required.");
            continue;
        }
        const value = input[key];
        if (key === "title" || key === "body") {
            const limit = key === "title" ? 160 : 10000;
            if (typeof value !== "string" || !value.trim() || Array.from(value.trim()).length > limit)
                throw taskInputError("TASK_INPUT_INVALID", "Task title or body has an invalid length.");
            result[key] = value.trim();
        } else if (key === "priority") {
            if (!["Low", "Medium", "High", "Critical"].includes(value))
                throw taskInputError("TASK_PRIORITY_INVALID", "Choose Low, Medium, High, or Critical.");
            result[key] = value;
        } else if (key === "timeline_days") {
            if (!Number.isSafeInteger(value) || value < 3 || value > 30)
                throw taskInputError("TASK_TIMELINE_INVALID", "Timeline days must be a valid whole number.");
            result[key] = value;
        } else {
            if (!Array.isArray(value) || !value.length || value.some(role => !ROLES.has(role)))
                throw taskInputError("TASK_ROLES_INVALID", "Select one or more roles: owner, database, security, ui.");
            result[key] = [...new Set(value)].sort();
        }
    }
    if (result.priority && result.timeline_days !== undefined) {
        const [min, max] = { Low: [30,30], Medium: [14,14], High: [5,13], Critical: [3,10] }[result.priority];
        if (result.timeline_days < min || result.timeline_days > max)
            throw taskInputError("TASK_TIMELINE_INVALID", "Timeline days are outside the range for this priority.");
    }
    // Partial updates are checked against the stored priority/timeline by the RPC.
    return result;
}
