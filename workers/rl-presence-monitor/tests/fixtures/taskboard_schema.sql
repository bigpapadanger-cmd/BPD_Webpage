-- Isolated test fixture reconstructed from supplied schema. Never run on Supabase.
CREATE SCHEMA admin; CREATE SCHEMA api; CREATE SCHEMA identity;
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
GRANT USAGE ON SCHEMA api TO anon,authenticated,service_role;
CREATE TABLE identity.accounts(id uuid PRIMARY KEY, active boolean NOT NULL DEFAULT true);
-- Deterministic test-only generator; production retains its existing generator.
CREATE SEQUENCE admin.test_code_sequence;
CREATE FUNCTION admin.generate_task_code() RETURNS text LANGUAGE sql AS $$ SELECT 'TASK-'||lpad(nextval('admin.test_code_sequence')::text,6,'A') $$;
CREATE FUNCTION admin.valid_responsible_roles(text[]) RETURNS boolean LANGUAGE sql AS $$ SELECT $1 IS NOT NULL AND cardinality($1)>0 AND NOT EXISTS(SELECT 1 FROM unnest($1) r WHERE r IS NULL OR r NOT IN ('owner','database','security','ui')) $$;
CREATE TABLE admin.tasks(id uuid NOT NULL DEFAULT gen_random_uuid(), task_code text NOT NULL DEFAULT admin.generate_task_code(),
 creator_account_id uuid, created_at timestamptz NOT NULL DEFAULT now(), title text NOT NULL, body text NOT NULL, priority text NOT NULL,
 timeline_days integer NOT NULL, deadline date NOT NULL, responsible_roles text[] NOT NULL, status text NOT NULL DEFAULT 'To Do',
 updated_at timestamptz NOT NULL DEFAULT now(),updated_by_account_id uuid, completed_at timestamptz,
 shelved_until date,shelved_reason text,shelved_by_account_id uuid,archived_at timestamptz,archived_reason text,archived_by_account_id uuid,
 deleted_at timestamptz,deleted_reason text,deleted_by_account_id uuid,previous_status text);
CREATE TABLE admin.task_events(id uuid NOT NULL DEFAULT gen_random_uuid(),task_id uuid NOT NULL,actor_account_id uuid,
 event_type text NOT NULL,note text,previous_data jsonb,new_data jsonb,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE admin.tasks ADD CONSTRAINT admin_tasks_body_length CHECK (((char_length(btrim(body)) >= 1) AND (char_length(btrim(body)) <= 10000)));
ALTER TABLE admin.tasks ADD CONSTRAINT admin_tasks_critical_timeline CHECK (((priority <> 'Critical'::text) OR ((timeline_days >= 3) AND (timeline_days <= 10))));
ALTER TABLE admin.tasks ADD CONSTRAINT admin_tasks_high_timeline CHECK (((priority <> 'High'::text) OR ((timeline_days >= 5) AND (timeline_days <= 13))));
ALTER TABLE admin.tasks ADD CONSTRAINT admin_tasks_low_timeline CHECK (((priority <> 'Low'::text) OR (timeline_days = 30)));
ALTER TABLE admin.tasks ADD CONSTRAINT admin_tasks_medium_timeline CHECK (((priority <> 'Medium'::text) OR (timeline_days = 14)));
ALTER TABLE admin.tasks ADD CONSTRAINT admin_tasks_previous_status_valid CHECK (((previous_status IS NULL) OR (previous_status = ANY (ARRAY['To Do'::text, 'In Progress'::text, 'Completed'::text, 'Shelved'::text, 'Archived'::text, 'Deleted'::text]))));
ALTER TABLE admin.tasks ADD CONSTRAINT admin_tasks_priority_valid CHECK ((priority = ANY (ARRAY['Low'::text, 'Medium'::text, 'High'::text, 'Critical'::text])));
ALTER TABLE admin.tasks ADD CONSTRAINT admin_tasks_responsible_roles_valid CHECK (admin.valid_responsible_roles(responsible_roles));
ALTER TABLE admin.tasks ADD CONSTRAINT admin_tasks_shelved_maximum CHECK (((shelved_until IS NULL) OR ((shelved_until >= (created_at)::date) AND (shelved_until <= (CURRENT_DATE + 30)))));
ALTER TABLE admin.tasks ADD CONSTRAINT admin_tasks_status_valid CHECK ((status = ANY (ARRAY['To Do'::text, 'In Progress'::text, 'Completed'::text, 'Shelved'::text, 'Archived'::text, 'Deleted'::text])));
ALTER TABLE admin.tasks ADD CONSTRAINT admin_tasks_task_code_unique UNIQUE (task_code);
ALTER TABLE admin.tasks ADD CONSTRAINT admin_tasks_title_length CHECK (((char_length(btrim(title)) >= 1) AND (char_length(btrim(title)) <= 160)));
ALTER TABLE admin.tasks ADD CONSTRAINT tasks_archived_by_account_id_fkey FOREIGN KEY (archived_by_account_id) REFERENCES identity.accounts(id) ON DELETE SET NULL;
ALTER TABLE admin.tasks ADD CONSTRAINT tasks_creator_account_id_fkey FOREIGN KEY (creator_account_id) REFERENCES identity.accounts(id) ON DELETE SET NULL;
ALTER TABLE admin.tasks ADD CONSTRAINT tasks_deleted_by_account_id_fkey FOREIGN KEY (deleted_by_account_id) REFERENCES identity.accounts(id) ON DELETE SET NULL;
ALTER TABLE admin.tasks ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);
ALTER TABLE admin.tasks ADD CONSTRAINT tasks_shelved_by_account_id_fkey FOREIGN KEY (shelved_by_account_id) REFERENCES identity.accounts(id) ON DELETE SET NULL;
ALTER TABLE admin.tasks ADD CONSTRAINT tasks_updated_by_account_id_fkey FOREIGN KEY (updated_by_account_id) REFERENCES identity.accounts(id) ON DELETE SET NULL;
ALTER TABLE admin.task_events ADD CONSTRAINT admin_task_events_note_length CHECK (((note IS NULL) OR (char_length(btrim(note)) <= 5000)));
ALTER TABLE admin.task_events ADD CONSTRAINT admin_task_events_type_valid CHECK ((event_type = ANY (ARRAY['created'::text, 'updated'::text, 'title_changed'::text, 'body_changed'::text, 'priority_changed'::text, 'timeline_changed'::text, 'assignment_changed'::text, 'status_changed'::text, 'completed'::text, 'reopened'::text, 'shelved'::text, 'restored'::text, 'archived'::text, 'deleted'::text, 'comment'::text])));
ALTER TABLE admin.task_events ADD CONSTRAINT task_events_actor_account_id_fkey FOREIGN KEY (actor_account_id) REFERENCES identity.accounts(id) ON DELETE SET NULL;
ALTER TABLE admin.task_events ADD CONSTRAINT task_events_pkey PRIMARY KEY (id);
ALTER TABLE admin.task_events ADD CONSTRAINT task_events_task_id_fkey FOREIGN KEY (task_id) REFERENCES admin.tasks(id) ON DELETE CASCADE;
CREATE OR REPLACE FUNCTION api.admin_restore_deleted_task(p_task_code text, p_expected_version bigint, p_actor_account_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'admin', 'api', 'identity'
AS $function$
declare
    v_task_before admin.tasks%rowtype;
    v_task_after admin.tasks%rowtype;
    v_task_code text :=
        upper(
            btrim(
                coalesce(
                    p_task_code,
                    ''
                )
            )
        );
    v_restored_at timestamptz :=
        statement_timestamp();
begin

/* =========================================================
INPUT VALIDATION
========================================================= */

    if v_task_code = '' then
        raise exception using
            errcode = '22023',
            message = 'TASK_CODE_REQUIRED',
            detail = 'A task code is required.';
    end if;

    if v_task_code !~ '^TASK-[A-HJ-NP-Z2-9]{6}$' then
        raise exception using
            errcode = '22023',
            message = 'TASK_CODE_INVALID',
            detail = 'The supplied task code is invalid.';
    end if;

    if p_expected_version is null
       or p_expected_version < 1 then
        raise exception using
            errcode = '22023',
            message = 'EXPECTED_VERSION_REQUIRED',
            detail = 'A valid expected task version is required.';
    end if;

    if p_actor_account_id is null then
        raise exception using
            errcode = '22023',
            message = 'ACTOR_REQUIRED',
            detail = 'The authenticated account is required.';
    end if;

/* =========================================================
LOAD CURRENT TASK
========================================================= */

    select
        *
    into
        v_task_before
    from
        admin.tasks
    where
        task_code = v_task_code;

    if not found then
        raise exception using
            errcode = 'P0002',
            message = 'TASK_NOT_FOUND',
            detail =
                'No task exists with code '
                || v_task_code
                || '.';
    end if;

/* =========================================================
OPTIMISTIC CONCURRENCY PRECHECK
========================================================= */

    if v_task_before.version <> p_expected_version then
        raise exception using
            errcode = '40001',
            message = 'TASK_VERSION_CONFLICT',
            detail = format(
                'Expected version %s but current version is %s.',
                p_expected_version,
                v_task_before.version
            ),
            hint =
                'Reload the task before restoring it.';
    end if;

/* =========================================================
LIFECYCLE VALIDATION
========================================================= */

    if v_task_before.deleted_at is null then
        raise exception using
            errcode = '55000',
            message = 'TASK_NOT_DELETED',
            detail =
                'Only deleted tasks can be restored.';
    end if;

/* =========================================================
ATOMIC RESTORE

Only deleted_at is cleared.

All prior lifecycle state remains intact:
- completed_at
- shelved_at
- archived_at

That means restoration returns the task to the state it had
immediately before deletion.
========================================================= */

    update
        admin.tasks
    set
        deleted_at = null,
        updated_at = v_restored_at,
        version = version + 1
    where
        id = v_task_before.id
        and version = p_expected_version
        and deleted_at is not null
    returning
        *
    into
        v_task_after;

/* =========================================================
FINAL CONCURRENCY GUARD
========================================================= */

    if not found then
        raise exception using
            errcode = '40001',
            message = 'TASK_VERSION_CONFLICT',
            detail =
                'The task changed while restoration was being processed.',
            hint =
                'Reload the task and retry with its current version.';
    end if;

/* =========================================================
AUDIT EVENT
========================================================= */

    insert into admin.task_events (
        task_id,
        event_type,
        actor_account_id,
        previous_version,
        resulting_version,
        changes,
        created_at
    )
    values (
        v_task_after.id,
        'deleted_restored',
        p_actor_account_id,
        v_task_before.version,
        v_task_after.version,
        jsonb_build_object(
            'deleted_at',
            jsonb_build_object(
                'before',
                to_jsonb(
                    v_task_before.deleted_at
                ),
                'after',
                'null'::jsonb
            )
        ),
        v_restored_at
    );

/* =========================================================
AUTHORITATIVE RESPONSE
========================================================= */

    return jsonb_build_object(
        'success', true,
        'changed', true,
        'task', to_jsonb(v_task_after),
        'previousVersion',
            v_task_before.version,
        'version',
            v_task_after.version
    );
end;
$function$;
CREATE OR REPLACE FUNCTION api.admin_get_task(p_task_code text, p_include_deleted boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'admin', 'api'
AS $function$
declare
    v_task admin.tasks%rowtype;
    v_task_code text :=
        upper(
            btrim(
                coalesce(
                    p_task_code,
                    ''
                )
            )
        );
begin

/* =========================================================
INPUT VALIDATION
========================================================= */

    if v_task_code = '' then
        raise exception using
            errcode = '22023',
            message = 'TASK_CODE_REQUIRED',
            detail = 'A task code is required.';
    end if;

    if v_task_code !~ '^TASK-[A-HJ-NP-Z2-9]{6}$' then
        raise exception using
            errcode = '22023',
            message = 'TASK_CODE_INVALID',
            detail = 'The supplied task code is invalid.';
    end if;

/* =========================================================
LOAD TASK

Deleted records remain inaccessible unless the trusted caller
explicitly requests them.

Authorization for using p_include_deleted=true should be
enforced by the server layer before this RPC is called.
========================================================= */

    select
        *
    into
        v_task
    from
        admin.tasks
    where
        task_code = v_task_code
        and (
            coalesce(
                p_include_deleted,
                false
            )
            or deleted_at is null
        );

    if not found then
        raise exception using
            errcode = 'P0002',
            message = 'TASK_NOT_FOUND',
            detail =
                'No accessible task exists with code '
                || v_task_code
                || '.';
    end if;

/* =========================================================
AUTHORITATIVE RESPONSE
========================================================= */

    return jsonb_build_object(
        'success', true,
        'task', to_jsonb(v_task),
        'version', v_task.version
    );
end;
$function$;
CREATE OR REPLACE FUNCTION api.admin_list_tasks(p_filters jsonb DEFAULT '{}'::jsonb, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'admin', 'api'
AS $function$
declare
    v_filters jsonb :=
        coalesce(
            p_filters,
            '{}'::jsonb
        );

    v_limit integer :=
        least(
            greatest(
                coalesce(
                    p_limit,
                    50
                ),
                1
            ),
            200
        );

    v_offset integer :=
        greatest(
            coalesce(
                p_offset,
                0
            ),
            0
        );

    v_search text;
    v_priority text;
    v_timeline text;
    v_assigned_role text;
    v_assigned_account_id uuid;
    v_lifecycle text;
    v_include_deleted boolean := false;

    v_total bigint := 0;
    v_tasks jsonb := '[]'::jsonb;

    v_invalid_keys text[];

    v_allowed_keys constant text[] := array[
        'search',
        'priority',
        'timeline',
        'assignedRole',
        'assignedAccountId',
        'lifecycle',
        'includeDeleted'
    ];
begin

/* =========================================================
INPUT VALIDATION
========================================================= */

    if jsonb_typeof(v_filters) <> 'object' then
        raise exception using
            errcode = '22023',
            message = 'TASK_FILTERS_INVALID',
            detail =
                'Task filters must be a JSON object.';
    end if;

/* =========================================================
FILTER ALLOWLIST

Fail closed so new filter behavior is introduced deliberately.
========================================================= */

    select
        array_agg(
            key
            order by key
        )
    into
        v_invalid_keys
    from
        jsonb_object_keys(
            v_filters
        ) as supplied(key)
    where
        not (
            supplied.key =
            any(v_allowed_keys)
        );

    if v_invalid_keys is not null then
        raise exception using
            errcode = '22023',
            message = 'TASK_FILTERS_UNSUPPORTED',
            detail =
                'Unsupported task filters: '
                || array_to_string(
                    v_invalid_keys,
                    ', '
                );
    end if;

/* =========================================================
NORMALIZE FILTERS
========================================================= */

    v_search :=
        nullif(
            btrim(
                v_filters ->> 'search'
            ),
            ''
        );

    v_priority :=
        nullif(
            lower(
                btrim(
                    v_filters ->> 'priority'
                )
            ),
            ''
        );

    v_timeline :=
        nullif(
            lower(
                btrim(
                    v_filters ->> 'timeline'
                )
            ),
            ''
        );

    v_assigned_role :=
        nullif(
            lower(
                btrim(
                    v_filters ->> 'assignedRole'
                )
            ),
            ''
        );

    v_lifecycle :=
        nullif(
            lower(
                btrim(
                    v_filters ->> 'lifecycle'
                )
            ),
            ''
        );

    if v_filters ? 'includeDeleted' then
        if jsonb_typeof(
            v_filters -> 'includeDeleted'
        ) <> 'boolean' then
            raise exception using
                errcode = '22023',
                message = 'INCLUDE_DELETED_INVALID';
        end if;

        v_include_deleted :=
            (
                v_filters ->>
                'includeDeleted'
            )::boolean;
    end if;

    if v_filters ? 'assignedAccountId'
       and v_filters -> 'assignedAccountId' <>
           'null'::jsonb then
        begin
            v_assigned_account_id :=
                (
                    v_filters ->>
                    'assignedAccountId'
                )::uuid;
        exception
            when invalid_text_representation then
                raise exception using
                    errcode = '22023',
                    message = 'ASSIGNED_ACCOUNT_ID_INVALID';
        end;
    end if;

/* =========================================================
LIFECYCLE VALIDATION
========================================================= */

    if v_lifecycle is not null
       and v_lifecycle not in (
            'active',
            'completed',
            'shelved',
            'archived',
            'deleted',
            'all'
       ) then
        raise exception using
            errcode = '22023',
            message = 'TASK_LIFECYCLE_INVALID',
            detail =
                'Unsupported lifecycle filter.';
    end if;

/* =========================================================
COUNT MATCHING TASKS
========================================================= */

    select
        count(*)
    into
        v_total
    from
        admin.tasks t
    where

/* ---------------------------------------------------------
DELETED VISIBILITY
--------------------------------------------------------- */

        (
            v_include_deleted
            or t.deleted_at is null
        )

/* ---------------------------------------------------------
SPECIFIC LIFECYCLE
--------------------------------------------------------- */

        and (
            v_lifecycle is null

            or v_lifecycle = 'all'

            or (
                v_lifecycle = 'active'
                and t.completed_at is null
                and t.shelved_at is null
                and t.archived_at is null
                and t.deleted_at is null
            )

            or (
                v_lifecycle = 'completed'
                and t.completed_at is not null
                and t.archived_at is null
                and t.deleted_at is null
            )

            or (
                v_lifecycle = 'shelved'
                and t.shelved_at is not null
                and t.archived_at is null
                and t.deleted_at is null
            )

            or (
                v_lifecycle = 'archived'
                and t.archived_at is not null
                and t.deleted_at is null
            )

            or (
                v_lifecycle = 'deleted'
                and v_include_deleted
                and t.deleted_at is not null
            )
        )

/* ---------------------------------------------------------
PRIORITY
--------------------------------------------------------- */

        and (
            v_priority is null
            or lower(t.priority) = v_priority
        )

/* ---------------------------------------------------------
TIMELINE
--------------------------------------------------------- */

        and (
            v_timeline is null
            or lower(t.timeline) = v_timeline
        )

/* ---------------------------------------------------------
ROLE ASSIGNMENT
--------------------------------------------------------- */

        and (
            v_assigned_role is null
            or lower(t.assigned_role) =
               v_assigned_role
        )

/* ---------------------------------------------------------
ACCOUNT ASSIGNMENT
--------------------------------------------------------- */

        and (
            v_assigned_account_id is null
            or t.assigned_account_id =
               v_assigned_account_id
        )

/* ---------------------------------------------------------
SEARCH

Task code and title are intentionally searched directly.

Description is included for administrative discoverability.
--------------------------------------------------------- */

        and (
            v_search is null

            or t.task_code ilike
                '%' || v_search || '%'

            or t.title ilike
                '%' || v_search || '%'

            or coalesce(
                t.description,
                ''
            ) ilike
                '%' || v_search || '%'
        );

/* =========================================================
LOAD PAGE

Late state is calculated here rather than persisted.

The JSON expression deliberately checks the authoritative task
row for a due_at value without requiring "late" to exist as
a database column.

If your task foundation names the deadline column differently,
change only this due_at extraction.
========================================================= */

    select
        coalesce(
            jsonb_agg(
                task_result
                order by
                    sort_lifecycle,
                    sort_due_at nulls last,
                    sort_created_at desc,
                    sort_id
            ),
            '[]'::jsonb
        )
    into
        v_tasks
    from (
        select
            (
                to_jsonb(t)
                ||
                jsonb_build_object(
                    'is_late',
                    case
                        when t.completed_at is not null
                            or t.shelved_at is not null
                            or t.archived_at is not null
                            or t.deleted_at is not null
                        then false

                        when nullif(
                            to_jsonb(t) ->> 'due_at',
                            ''
                        ) is null
                        then false

                        else (
                            (
                                to_jsonb(t) ->>
                                'due_at'
                            )::timestamptz
                            < statement_timestamp()
                        )
                    end
                )
            ) as task_result,

            case
                when t.deleted_at is not null
                    then 5
                when t.archived_at is not null
                    then 4
                when t.shelved_at is not null
                    then 3
                when t.completed_at is not null
                    then 2
                else 1
            end as sort_lifecycle,

            case
                when nullif(
                    to_jsonb(t) ->> 'due_at',
                    ''
                ) is null
                then null

                else (
                    to_jsonb(t) ->>
                    'due_at'
                )::timestamptz
            end as sort_due_at,

            t.created_at as sort_created_at,
            t.id as sort_id

        from
            admin.tasks t

        where
            (
                v_include_deleted
                or t.deleted_at is null
            )

            and (
                v_lifecycle is null

                or v_lifecycle = 'all'

                or (
                    v_lifecycle = 'active'
                    and t.completed_at is null
                    and t.shelved_at is null
                    and t.archived_at is null
                    and t.deleted_at is null
                )

                or (
                    v_lifecycle = 'completed'
                    and t.completed_at is not null
                    and t.archived_at is null
                    and t.deleted_at is null
                )

                or (
                    v_lifecycle = 'shelved'
                    and t.shelved_at is not null
                    and t.archived_at is null
                    and t.deleted_at is null
                )

                or (
                    v_lifecycle = 'archived'
                    and t.archived_at is not null
                    and t.deleted_at is null
                )

                or (
                    v_lifecycle = 'deleted'
                    and v_include_deleted
                    and t.deleted_at is not null
                )
            )

            and (
                v_priority is null
                or lower(t.priority) =
                   v_priority
            )

            and (
                v_timeline is null
                or lower(t.timeline) =
                   v_timeline
            )

            and (
                v_assigned_role is null
                or lower(t.assigned_role) =
                   v_assigned_role
            )

            and (
                v_assigned_account_id is null
                or t.assigned_account_id =
                   v_assigned_account_id
            )

            and (
                v_search is null

                or t.task_code ilike
                    '%' || v_search || '%'

                or t.title ilike
                    '%' || v_search || '%'

                or coalesce(
                    t.description,
                    ''
                ) ilike
                    '%' || v_search || '%'
            )

        order by
            case
                when t.deleted_at is not null
                    then 5
                when t.archived_at is not null
                    then 4
                when t.shelved_at is not null
                    then 3
                when t.completed_at is not null
                    then 2
                else 1
            end,

            case
                when nullif(
                    to_jsonb(t) ->> 'due_at',
                    ''
                ) is null
                then null

                else (
                    to_jsonb(t) ->>
                    'due_at'
                )::timestamptz
            end
            nulls last,

            t.created_at desc,
            t.id

        limit v_limit
        offset v_offset
    ) page;

/* =========================================================
AUTHORITATIVE RESPONSE
========================================================= */

    return jsonb_build_object(
        'success', true,
        'tasks', v_tasks,
        'pagination',
            jsonb_build_object(
                'limit', v_limit,
                'offset', v_offset,
                'returned',
                    jsonb_array_length(
                        v_tasks
                    ),
                'total', v_total,
                'hasMore',
                    (
                        v_offset
                        +
                        jsonb_array_length(
                            v_tasks
                        )
                    ) < v_total
            ),
        'filters',
            jsonb_build_object(
                'search', v_search,
                'priority', v_priority,
                'timeline', v_timeline,
                'assignedRole',
                    v_assigned_role,
                'assignedAccountId',
                    v_assigned_account_id,
                'lifecycle',
                    v_lifecycle,
                'includeDeleted',
                    v_include_deleted
            )
    );
end;
$function$;
CREATE OR REPLACE FUNCTION api.admin_get_task_events(p_task_code text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'admin', 'api'
AS $function$
declare
    v_task_id uuid;
    v_task_version bigint;

    v_task_code text :=
        upper(
            btrim(
                coalesce(
                    p_task_code,
                    ''
                )
            )
        );

    v_limit integer :=
        least(
            greatest(
                coalesce(
                    p_limit,
                    50
                ),
                1
            ),
            200
        );

    v_offset integer :=
        greatest(
            coalesce(
                p_offset,
                0
            ),
            0
        );

    v_total bigint := 0;
    v_events jsonb := '[]'::jsonb;
begin

/* =========================================================
INPUT VALIDATION
========================================================= */

    if v_task_code = '' then
        raise exception using
            errcode = '22023',
            message = 'TASK_CODE_REQUIRED',
            detail = 'A task code is required.';
    end if;

    if v_task_code !~ '^TASK-[A-HJ-NP-Z2-9]{6}$' then
        raise exception using
            errcode = '22023',
            message = 'TASK_CODE_INVALID',
            detail = 'The supplied task code is invalid.';
    end if;

/* =========================================================
TASK LOOKUP

Deleted tasks are intentionally included because their audit
history remains valid and useful.
========================================================= */

    select
        id,
        version
    into
        v_task_id,
        v_task_version
    from
        admin.tasks
    where
        task_code = v_task_code;

    if not found then
        raise exception using
            errcode = 'P0002',
            message = 'TASK_NOT_FOUND',
            detail =
                'No task exists with code '
                || v_task_code
                || '.';
    end if;

/* =========================================================
COUNT EVENTS
========================================================= */

    select
        count(*)
    into
        v_total
    from
        admin.task_events e
    where
        e.task_id = v_task_id;

/* =========================================================
LOAD PAGE

Newest event first.

ID is used as the final deterministic tie-breaker where
available.
========================================================= */

    select
        coalesce(
            jsonb_agg(
                event_row
                order by
                    event_created_at desc,
                    event_id desc
            ),
            '[]'::jsonb
        )
    into
        v_events
    from (
        select
            to_jsonb(e) as event_row,
            e.created_at as event_created_at,
            e.id as event_id
        from
            admin.task_events e
        where
            e.task_id = v_task_id
        order by
            e.created_at desc,
            e.id desc
        limit
            v_limit
        offset
            v_offset
    ) page;

/* =========================================================
AUTHORITATIVE RESPONSE
========================================================= */

    return jsonb_build_object(
        'success', true,

        'task',
            jsonb_build_object(
                'taskCode',
                    v_task_code,
                'version',
                    v_task_version
            ),

        'events',
            v_events,

        'pagination',
            jsonb_build_object(
                'limit',
                    v_limit,

                'offset',
                    v_offset,

                'returned',
                    jsonb_array_length(
                        v_events
                    ),

                'total',
                    v_total,

                'hasMore',
                    (
                        v_offset
                        +
                        jsonb_array_length(
                            v_events
                        )
                    ) < v_total
            )
    );
end;
$function$;
CREATE OR REPLACE FUNCTION api.admin_create_task(p_task jsonb, p_actor_account_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'admin', 'api', 'identity'
AS $function$
declare
    v_task_input jsonb :=
        coalesce(
            p_task,
            '{}'::jsonb
        );

    v_task admin.tasks%rowtype;

    v_allowed_keys constant text[] := array[
        'title',
        'description',
        'priority',
        'timeline',
        'assigned_role',
        'assigned_account_id',
        'due_at'
    ];

    v_invalid_keys text[];

    v_title text;
    v_description text;
    v_priority text;
    v_timeline text;
    v_assigned_role text;
    v_assigned_account_id uuid;
    v_due_at timestamptz;

    v_task_code text;
    v_now timestamptz :=
        statement_timestamp();

    v_attempt integer := 0;
begin

/* =========================================================
INPUT VALIDATION
========================================================= */

    if p_actor_account_id is null then
        raise exception using
            errcode = '22023',
            message = 'ACTOR_REQUIRED',
            detail = 'The authenticated account is required.';
    end if;

    if jsonb_typeof(v_task_input) <> 'object' then
        raise exception using
            errcode = '22023',
            message = 'TASK_INPUT_INVALID',
            detail = 'Task input must be a JSON object.';
    end if;

/* =========================================================
FIELD ALLOWLIST

Fail closed.

New columns do not automatically become writable through
task creation.
========================================================= */

    select
        array_agg(
            key
            order by key
        )
    into
        v_invalid_keys
    from
        jsonb_object_keys(
            v_task_input
        ) as supplied(key)
    where
        not (
            supplied.key =
            any(v_allowed_keys)
        );

    if v_invalid_keys is not null then
        raise exception using
            errcode = '22023',
            message = 'TASK_FIELDS_NOT_CREATABLE',
            detail =
                'Unsupported task fields: '
                || array_to_string(
                    v_invalid_keys,
                    ', '
                );
    end if;

/* =========================================================
TITLE
========================================================= */

    if not (
        v_task_input ? 'title'
    ) then
        raise exception using
            errcode = '22023',
            message = 'TASK_TITLE_REQUIRED';
    end if;

    if jsonb_typeof(
        v_task_input -> 'title'
    ) <> 'string' then
        raise exception using
            errcode = '22023',
            message = 'TASK_TITLE_INVALID';
    end if;

    v_title :=
        btrim(
            v_task_input ->> 'title'
        );

    if v_title = '' then
        raise exception using
            errcode = '22023',
            message = 'TASK_TITLE_REQUIRED';
    end if;

/* =========================================================
DESCRIPTION
========================================================= */

    if v_task_input ? 'description' then
        if jsonb_typeof(
            v_task_input -> 'description'
        ) not in (
            'string',
            'null'
        ) then
            raise exception using
                errcode = '22023',
                message = 'TASK_DESCRIPTION_INVALID';
        end if;

        v_description :=
            nullif(
                btrim(
                    v_task_input ->> 'description'
                ),
                ''
            );
    end if;

/* =========================================================
PRIORITY
========================================================= */

    if v_task_input ? 'priority' then
        if jsonb_typeof(
            v_task_input -> 'priority'
        ) <> 'string' then
            raise exception using
                errcode = '22023',
                message = 'TASK_PRIORITY_INVALID';
        end if;

        v_priority :=
            lower(
                btrim(
                    v_task_input ->> 'priority'
                )
            );
    end if;

/* =========================================================
TIMELINE
========================================================= */

    if v_task_input ? 'timeline' then
        if jsonb_typeof(
            v_task_input -> 'timeline'
        ) <> 'string' then
            raise exception using
                errcode = '22023',
                message = 'TASK_TIMELINE_INVALID';
        end if;

        v_timeline :=
            lower(
                btrim(
                    v_task_input ->> 'timeline'
                )
            );
    end if;

/* =========================================================
ASSIGNED ROLE
========================================================= */

    if v_task_input ? 'assigned_role' then
        if jsonb_typeof(
            v_task_input -> 'assigned_role'
        ) not in (
            'string',
            'null'
        ) then
            raise exception using
                errcode = '22023',
                message = 'TASK_ASSIGNED_ROLE_INVALID';
        end if;

        v_assigned_role :=
            nullif(
                lower(
                    btrim(
                        v_task_input ->> 'assigned_role'
                    )
                ),
                ''
            );
    end if;

/* =========================================================
ASSIGNED ACCOUNT
========================================================= */

    if v_task_input ? 'assigned_account_id'
       and v_task_input -> 'assigned_account_id' <>
           'null'::jsonb then
        begin
            v_assigned_account_id :=
                (
                    v_task_input ->>
                    'assigned_account_id'
                )::uuid;
        exception
            when invalid_text_representation then
                raise exception using
                    errcode = '22023',
                    message = 'TASK_ASSIGNED_ACCOUNT_INVALID';
        end;
    end if;

/* =========================================================
DUE DATE
========================================================= */

    if v_task_input ? 'due_at'
       and v_task_input -> 'due_at' <>
           'null'::jsonb then
        begin
            v_due_at :=
                (
                    v_task_input ->>
                    'due_at'
                )::timestamptz;
        exception
            when invalid_datetime_format
              or datetime_field_overflow then
                raise exception using
                    errcode = '22023',
                    message = 'TASK_DUE_AT_INVALID';
        end;
    end if;

/* =========================================================
TASK CODE GENERATION

Alphabet excludes:
0 / O
1 / I

Generation retries on the extremely unlikely chance of a
collision.

TASK-XXXXXX gives a stable human-readable identifier while
the UUID remains the internal relational key.
========================================================= */

    loop
        v_attempt :=
            v_attempt + 1;

        if v_attempt > 20 then
            raise exception using
                errcode = '55000',
                message = 'TASK_CODE_GENERATION_FAILED',
                detail =
                    'Unable to generate a unique task code.';
        end if;

        select
            'TASK-'
            ||
            string_agg(
                substr(
                    'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
                    (
                        floor(
                            random() * 32
                        )::integer
                        + 1
                    ),
                    1
                ),
                ''
            )
        into
            v_task_code
        from
            generate_series(
                1,
                6
            );

        exit when not exists (
            select
                1
            from
                admin.tasks
            where
                task_code =
                v_task_code
        );
    end loop;

/* =========================================================
CREATE TASK

Defaults owned by admin.tasks remain database-controlled.

Explicit version = 1 establishes the optimistic-concurrency
baseline.
========================================================= */

    insert into admin.tasks (
        task_code,
        title,
        description,
        priority,
        timeline,
        assigned_role,
        assigned_account_id,
        due_at,
        created_by_account_id,
        version,
        created_at,
        updated_at
    )
    values (
        v_task_code,
        v_title,
        v_description,
        v_priority,
        v_timeline,
        v_assigned_role,
        v_assigned_account_id,
        v_due_at,
        p_actor_account_id,
        1,
        v_now,
        v_now
    )
    returning
        *
    into
        v_task;

/* =========================================================
INITIAL AUDIT EVENT
========================================================= */

    insert into admin.task_events (
        task_id,
        event_type,
        actor_account_id,
        previous_version,
        resulting_version,
        changes,
        created_at
    )
    values (
        v_task.id,
        'created',
        p_actor_account_id,
        null,
        v_task.version,
        jsonb_build_object(
            'task',
            to_jsonb(
                v_task
            )
        ),
        v_now
    );

/* =========================================================
AUTHORITATIVE RESPONSE
========================================================= */

    return jsonb_build_object(
        'success', true,
        'task', to_jsonb(v_task),
        'version', v_task.version
    );
end;
$function$;
CREATE OR REPLACE FUNCTION api.admin_get_task_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'admin', 'api'
AS $function$
declare
    v_result jsonb;
begin
    select
        jsonb_build_object(
            'success', true,

            'total',
                count(*) filter (
                    where deleted_at is null
                ),

            'active',
                count(*) filter (
                    where deleted_at is null
                      and archived_at is null
                      and shelved_at is null
                      and completed_at is null
                ),

            'completed',
                count(*) filter (
                    where deleted_at is null
                      and archived_at is null
                      and completed_at is not null
                ),

            'shelved',
                count(*) filter (
                    where deleted_at is null
                      and archived_at is null
                      and shelved_at is not null
                ),

            'archived',
                count(*) filter (
                    where deleted_at is null
                      and archived_at is not null
                ),

            'late',
                count(*) filter (
                    where deleted_at is null
                      and archived_at is null
                      and shelved_at is null
                      and completed_at is null
                      and nullif(
                            to_jsonb(admin.tasks) ->> 'due_at',
                            ''
                          ) is not null
                      and (
                            to_jsonb(admin.tasks) ->> 'due_at'
                          )::timestamptz
                          < statement_timestamp()
                ),

            'priority',
                jsonb_build_object(
                    'low',
                        count(*) filter (
                            where deleted_at is null
                              and lower(priority) = 'low'
                        ),
                    'medium',
                        count(*) filter (
                            where deleted_at is null
                              and lower(priority) = 'medium'
                        ),
                    'high',
                        count(*) filter (
                            where deleted_at is null
                              and lower(priority) = 'high'
                        ),
                    'critical',
                        count(*) filter (
                            where deleted_at is null
                              and lower(priority) = 'critical'
                        )
                )
        )
    into
        v_result
    from
        admin.tasks;

    return v_result;
end;
$function$;
CREATE OR REPLACE FUNCTION api.admin_get_task_assignees()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'identity', 'api'
AS $function$
declare
    v_accounts jsonb := '[]'::jsonb;
    v_roles jsonb := '[]'::jsonb;
begin

/* =========================================================
ASSIGNABLE ACCOUNTS

Only accounts with at least one active application role are
returned.

Display name is read defensively from the canonical account
record so this RPC does not depend on provider identities.
========================================================= */

    select
        coalesce(
            jsonb_agg(
                account_row
                order by
                    lower(
                        coalesce(
                            account_row ->> 'displayName',
                            ''
                        )
                    ),
                    account_row ->> 'accountId'
            ),
            '[]'::jsonb
        )
    into
        v_accounts
    from (
        select
            jsonb_build_object(
                'accountId',
                    a.id,

                'displayName',
                    coalesce(
                        nullif(
                            btrim(
                                to_jsonb(a) ->>
                                'display_name'
                            ),
                            ''
                        ),
                        nullif(
                            btrim(
                                to_jsonb(a) ->>
                                'username'
                            ),
                            ''
                        ),
                        a.id::text
                    ),

                'roles',
                    coalesce(
                        jsonb_agg(
                            ar.role
                            order by ar.role
                        ) filter (
                            where ar.role is not null
                        ),
                        '[]'::jsonb
                    )
            ) as account_row

        from
            identity.accounts a

        join
            identity.account_roles ar
        on
            ar.account_id = a.id
            and ar.revoked_at is null

        group by
            a.id,
            to_jsonb(a)
    ) accounts;

/* =========================================================
ASSIGNABLE ROLES

Role definitions currently come from active role membership.

This means unused/stale role names automatically disappear
from assignment options unless an active staff account still
holds that role.
========================================================= */

    select
        coalesce(
            jsonb_agg(
                role
                order by role
            ),
            '[]'::jsonb
        )
    into
        v_roles
    from (
        select distinct
            ar.role
        from
            identity.account_roles ar
        where
            ar.revoked_at is null
            and ar.role is not null
            and btrim(ar.role) <> ''
    ) active_roles;

/* =========================================================
AUTHORITATIVE RESPONSE
========================================================= */

    return jsonb_build_object(
        'success', true,
        'accounts', v_accounts,
        'roles', v_roles
    );
end;
$function$;
CREATE OR REPLACE FUNCTION api.admin_get_task_activity(p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'admin', 'api'
AS $function$
declare
    v_limit integer :=
        least(
            greatest(
                coalesce(
                    p_limit,
                    50
                ),
                1
            ),
            200
        );

    v_offset integer :=
        greatest(
            coalesce(
                p_offset,
                0
            ),
            0
        );

    v_total bigint := 0;
    v_activity jsonb := '[]'::jsonb;
begin

/* =========================================================
COUNT EVENTS
========================================================= */

    select
        count(*)
    into
        v_total
    from
        admin.task_events;

/* =========================================================
LOAD ACTIVITY PAGE

Task metadata is joined so the client does not need a second
request merely to display the human-readable task identity.
========================================================= */

    select
        coalesce(
            jsonb_agg(
                activity_row
                order by
                    event_created_at desc,
                    event_id desc
            ),
            '[]'::jsonb
        )
    into
        v_activity
    from (
        select
            jsonb_build_object(
                'event',
                    to_jsonb(e),

                'task',
                    jsonb_build_object(
                        'id',
                            t.id,
                        'taskCode',
                            t.task_code,
                        'title',
                            t.title,
                        'version',
                            t.version,
                        'completedAt',
                            t.completed_at,
                        'shelvedAt',
                            t.shelved_at,
                        'archivedAt',
                            t.archived_at,
                        'deletedAt',
                            t.deleted_at
                    )
            ) as activity_row,

            e.created_at as event_created_at,
            e.id as event_id

        from
            admin.task_events e

        join
            admin.tasks t
        on
            t.id = e.task_id

        order by
            e.created_at desc,
            e.id desc

        limit
            v_limit

        offset
            v_offset
    ) page;

/* =========================================================
AUTHORITATIVE RESPONSE
========================================================= */

    return jsonb_build_object(
        'success', true,

        'activity',
            v_activity,

        'pagination',
            jsonb_build_object(
                'limit',
                    v_limit,

                'offset',
                    v_offset,

                'returned',
                    jsonb_array_length(
                        v_activity
                    ),

                'total',
                    v_total,

                'hasMore',
                    (
                        v_offset
                        +
                        jsonb_array_length(
                            v_activity
                        )
                    ) < v_total
            )
    );
end;
$function$;
CREATE OR REPLACE FUNCTION api.admin_list_task_activity(p_filters jsonb DEFAULT '{}'::jsonb, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'admin', 'api'
AS $function$
declare
    v_filters jsonb :=
        coalesce(
            p_filters,
            '{}'::jsonb
        );

    v_limit integer :=
        least(
            greatest(
                coalesce(
                    p_limit,
                    50
                ),
                1
            ),
            200
        );

    v_offset integer :=
        greatest(
            coalesce(
                p_offset,
                0
            ),
            0
        );

    v_task_code text;
    v_actor_account_id uuid;
    v_event_type text;
    v_created_after timestamptz;
    v_created_before timestamptz;

    v_invalid_keys text[];

    v_allowed_keys constant text[] := array[
        'taskCode',
        'actorAccountId',
        'eventType',
        'createdAfter',
        'createdBefore'
    ];

    v_total bigint := 0;
    v_activity jsonb := '[]'::jsonb;
begin

/* =========================================================
FILTER OBJECT VALIDATION
========================================================= */

    if jsonb_typeof(v_filters) <> 'object' then
        raise exception using
            errcode = '22023',
            message = 'TASK_ACTIVITY_FILTERS_INVALID',
            detail =
                'Activity filters must be a JSON object.';
    end if;

/* =========================================================
FILTER ALLOWLIST
========================================================= */

    select
        array_agg(
            key
            order by key
        )
    into
        v_invalid_keys
    from
        jsonb_object_keys(
            v_filters
        ) as supplied(key)
    where
        not (
            supplied.key =
            any(v_allowed_keys)
        );

    if v_invalid_keys is not null then
        raise exception using
            errcode = '22023',
            message = 'TASK_ACTIVITY_FILTERS_UNSUPPORTED',
            detail =
                'Unsupported activity filters: '
                || array_to_string(
                    v_invalid_keys,
                    ', '
                );
    end if;

/* =========================================================
TASK CODE
========================================================= */

    if v_filters ? 'taskCode' then
        if jsonb_typeof(
            v_filters -> 'taskCode'
        ) <> 'string' then
            raise exception using
                errcode = '22023',
                message = 'TASK_CODE_INVALID';
        end if;

        v_task_code :=
            upper(
                btrim(
                    v_filters ->> 'taskCode'
                )
            );

        if v_task_code = '' then
            v_task_code := null;

        elsif v_task_code !~ '^TASK-[A-HJ-NP-Z2-9]{6}$' then
            raise exception using
                errcode = '22023',
                message = 'TASK_CODE_INVALID',
                detail =
                    'The supplied task code is invalid.';
        end if;
    end if;

/* =========================================================
ACTOR ACCOUNT
========================================================= */

    if v_filters ? 'actorAccountId'
       and v_filters -> 'actorAccountId' <>
           'null'::jsonb then
        begin
            v_actor_account_id :=
                (
                    v_filters ->>
                    'actorAccountId'
                )::uuid;
        exception
            when invalid_text_representation then
                raise exception using
                    errcode = '22023',
                    message = 'ACTOR_ACCOUNT_ID_INVALID';
        end;
    end if;

/* =========================================================
EVENT TYPE
========================================================= */

    if v_filters ? 'eventType' then
        if jsonb_typeof(
            v_filters -> 'eventType'
        ) <> 'string' then
            raise exception using
                errcode = '22023',
                message = 'TASK_EVENT_TYPE_INVALID';
        end if;

        v_event_type :=
            nullif(
                lower(
                    btrim(
                        v_filters ->> 'eventType'
                    )
                ),
                ''
            );
    end if;

/* =========================================================
DATE RANGE
========================================================= */

    if v_filters ? 'createdAfter'
       and v_filters -> 'createdAfter' <>
           'null'::jsonb then
        begin
            v_created_after :=
                (
                    v_filters ->>
                    'createdAfter'
                )::timestamptz;
        exception
            when invalid_datetime_format
              or datetime_field_overflow then
                raise exception using
                    errcode = '22023',
                    message = 'CREATED_AFTER_INVALID';
        end;
    end if;

    if v_filters ? 'createdBefore'
       and v_filters -> 'createdBefore' <>
           'null'::jsonb then
        begin
            v_created_before :=
                (
                    v_filters ->>
                    'createdBefore'
                )::timestamptz;
        exception
            when invalid_datetime_format
              or datetime_field_overflow then
                raise exception using
                    errcode = '22023',
                    message = 'CREATED_BEFORE_INVALID';
        end;
    end if;

    if v_created_after is not null
       and v_created_before is not null
       and v_created_after > v_created_before then
        raise exception using
            errcode = '22023',
            message = 'TASK_ACTIVITY_DATE_RANGE_INVALID',
            detail =
                'createdAfter cannot be later than createdBefore.';
    end if;

/* =========================================================
COUNT MATCHING EVENTS
========================================================= */

    select
        count(*)
    into
        v_total
    from
        admin.task_events e
    join
        admin.tasks t
    on
        t.id = e.task_id
    where
        (
            v_task_code is null
            or t.task_code = v_task_code
        )
        and (
            v_actor_account_id is null
            or e.actor_account_id =
               v_actor_account_id
        )
        and (
            v_event_type is null
            or lower(e.event_type) =
               v_event_type
        )
        and (
            v_created_after is null
            or e.created_at >=
               v_created_after
        )
        and (
            v_created_before is null
            or e.created_at <=
               v_created_before
        );

/* =========================================================
LOAD PAGE
========================================================= */

    select
        coalesce(
            jsonb_agg(
                activity_row
                order by
                    event_created_at desc,
                    event_id desc
            ),
            '[]'::jsonb
        )
    into
        v_activity
    from (
        select
            jsonb_build_object(
                'event',
                    to_jsonb(e),

                'task',
                    jsonb_build_object(
                        'id',
                            t.id,
                        'taskCode',
                            t.task_code,
                        'title',
                            t.title,
                        'version',
                            t.version,
                        'completedAt',
                            t.completed_at,
                        'shelvedAt',
                            t.shelved_at,
                        'archivedAt',
                            t.archived_at,
                        'deletedAt',
                            t.deleted_at
                    )
            ) as activity_row,

            e.created_at as event_created_at,
            e.id as event_id

        from
            admin.task_events e

        join
            admin.tasks t
        on
            t.id = e.task_id

        where
            (
                v_task_code is null
                or t.task_code =
                   v_task_code
            )
            and (
                v_actor_account_id is null
                or e.actor_account_id =
                   v_actor_account_id
            )
            and (
                v_event_type is null
                or lower(e.event_type) =
                   v_event_type
            )
            and (
                v_created_after is null
                or e.created_at >=
                   v_created_after
            )
            and (
                v_created_before is null
                or e.created_at <=
                   v_created_before
            )

        order by
            e.created_at desc,
            e.id desc

        limit
            v_limit

        offset
            v_offset
    ) page;

/* =========================================================
AUTHORITATIVE RESPONSE
========================================================= */

    return jsonb_build_object(
        'success', true,

        'activity',
            v_activity,

        'pagination',
            jsonb_build_object(
                'limit',
                    v_limit,

                'offset',
                    v_offset,

                'returned',
                    jsonb_array_length(
                        v_activity
                    ),

                'total',
                    v_total,

                'hasMore',
                    (
                        v_offset
                        +
                        jsonb_array_length(
                            v_activity
                        )
                    ) < v_total
            ),

        'filters',
            jsonb_build_object(
                'taskCode',
                    v_task_code,

                'actorAccountId',
                    v_actor_account_id,

                'eventType',
                    v_event_type,

                'createdAfter',
                    v_created_after,

                'createdBefore',
                    v_created_before
            )
    );
end;
$function$;
CREATE OR REPLACE FUNCTION admin.ensure_unique_task_code()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
    attempts integer :=
        0;
begin
    if
        new.task_code is null
        or btrim(new.task_code) = ''
    then
        loop
            new.task_code :=
                admin.generate_task_code();

            exit when not exists (
                select 1
                from admin.tasks
                where task_code =
                    new.task_code
            );

            attempts :=
                attempts + 1;

            if attempts >= 10 then
                raise exception
                    'Unable to generate unique task code';
            end if;
        end loop;
    end if;

    return new;
end;
$function$;
CREATE OR REPLACE FUNCTION admin.set_task_deadline()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
    new.deadline :=
        new.created_at::date
        + new.timeline_days;

    return new;
end;
$function$;
CREATE OR REPLACE FUNCTION admin.set_task_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
    new.updated_at :=
        now();

    return new;
end;
$function$;
CREATE OR REPLACE FUNCTION api.admin_create_task(p_actor_account_id uuid, p_title text, p_body text, p_priority text, p_responsible_roles text[], p_timeline_days integer DEFAULT NULL::integer, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'identity', 'admin', 'api'
AS $function$
declare
    v_title text;

    v_body text;

    v_priority text;

    v_note text;

    v_default_days integer;

    v_minimum_days integer;

    v_maximum_days integer;

    v_timeline_days integer;

    v_responsible_roles text[];

    v_invalid_role text;

    v_task_id uuid;

    v_task_code text;

    v_insert_attempt integer :=
        0;

    v_task jsonb;

    v_event_id uuid;
begin

    /* =====================================================
    ACTOR ACCOUNT

    Cloudflare determines authorization.

    Supabase still verifies that the supplied trusted actor
    corresponds to an existing active canonical BPD account.
    ===================================================== */

    if
        p_actor_account_id is null
    then
        raise exception
            'A BPD account is required.'
            using errcode =
                '22023';
    end if;

    if not exists (
        select 1
        from identity.accounts
        where id =
            p_actor_account_id
        and active =
            true
    ) then
        raise exception
            'The BPD account is missing or inactive.'
            using errcode =
                '42501';
    end if;


    /* =====================================================
    TITLE
    ===================================================== */

    v_title :=
        btrim(
            coalesce(
                p_title,
                ''
            )
        );

    if
        char_length(
            v_title
        ) not between 1 and 160
    then
        raise exception
            'Task title must contain between 1 and 160 characters.'
            using errcode =
                '22023';
    end if;


    /* =====================================================
    BODY
    ===================================================== */

    v_body :=
        btrim(
            coalesce(
                p_body,
                ''
            )
        );

    if
        char_length(
            v_body
        ) not between 1 and 10000
    then
        raise exception
            'Task body must contain between 1 and 10000 characters.'
            using errcode =
                '22023';
    end if;


    /* =====================================================
    PRIORITY

    Priority rules come from admin.task_priorities.

    This avoids duplicating the actual timeline policy inside
    the RPC.
    ===================================================== */

    v_priority :=
        btrim(
            coalesce(
                p_priority,
                ''
            )
        );

    select
        default_days,
        minimum_days,
        maximum_days
    into
        v_default_days,
        v_minimum_days,
        v_maximum_days
    from admin.task_priorities
    where priority =
        v_priority
    and active =
        true;

    if
        not found
    then
        raise exception
            'Task priority is invalid or inactive.'
            using errcode =
                '22023';
    end if;


    /* =====================================================
    TIMELINE

    If the client does not explicitly select a timeline,
    use the configured default for the priority.

    Current behavior therefore supports:

        Low      -> 30
        Medium   -> 14
        High     -> default 5, range 5-13
        Critical -> default 3, range 3-10
    ===================================================== */

    v_timeline_days :=
        coalesce(
            p_timeline_days,
            v_default_days
        );

    if
        v_timeline_days <
            v_minimum_days
        or v_timeline_days >
            v_maximum_days
    then
        raise exception
            'Timeline days are outside the permitted range for priority %.',
            v_priority
            using errcode =
                '22023';
    end if;


    /* =====================================================
    RESPONSIBLE ROLES

    Normalize:
        trim
        lowercase
        remove blank entries
        remove duplicates

    Role validity comes from:
        admin.task_responsibility_roles

    The RPC therefore does not need modification when future
    responsibility roles are added.
    ===================================================== */

    select
        array_agg(
            normalized_role
            order by
                normalized_role
        )
    into
        v_responsible_roles
    from (
        select distinct
            lower(
                btrim(
                    role_name
                )
            ) as normalized_role

        from unnest(
            coalesce(
                p_responsible_roles,
                array[]::text[]
            )
        ) as role_name

        where btrim(
            role_name
        ) <> ''
    ) as normalized;


    if
        v_responsible_roles is null
        or cardinality(
            v_responsible_roles
        ) = 0
    then
        raise exception
            'At least one responsible role is required.'
            using errcode =
                '22023';
    end if;


    /* -----------------------------------------------------
    FIND FIRST INVALID / INACTIVE ROLE
    ----------------------------------------------------- */

    select
        requested_role
    into
        v_invalid_role
    from unnest(
        v_responsible_roles
    ) as requested_role
    where not exists (
        select 1
        from admin.task_responsibility_roles
        where role_key =
            requested_role
        and active =
            true
    )
    limit 1;


    if
        v_invalid_role is not null
    then
        raise exception
            'Responsible role "%" is invalid or inactive.',
            v_invalid_role
            using errcode =
                '22023';
    end if;


    /* =====================================================
    OPTIONAL CREATION NOTE
    ===================================================== */

    v_note :=
        nullif(
            btrim(
                coalesce(
                    p_note,
                    ''
                )
            ),
            ''
        );

    if
        v_note is not null
        and char_length(
            v_note
        ) > 5000
    then
        raise exception
            'Task note may not exceed 5000 characters.'
            using errcode =
                '22023';
    end if;


    /* =====================================================
    CREATE TASK

    Status always begins as:
        To Do

    Database trigger controls:
        human task code
        deadline
        initial validation

    The small retry loop protects against the extremely rare
    TASK-XXXXXX collision race.
    ===================================================== */

    loop
        begin
            insert into admin.tasks (
                task_code,
                creator_account_id,
                title,
                body,
                priority,
                timeline_days,
                status,
                updated_by_account_id
            )
            values (
                null,
                p_actor_account_id,
                v_title,
                v_body,
                v_priority,
                v_timeline_days,
                'To Do',
                p_actor_account_id
            )
            returning
                id,
                task_code
            into
                v_task_id,
                v_task_code;

            exit;
        exception
            when unique_violation then
                v_insert_attempt :=
                    v_insert_attempt + 1;

                if
                    v_insert_attempt >= 5
                then
                    raise exception
                        'Unable to generate a unique task identifier.'
                        using errcode =
                            '23505';
                end if;
        end;
    end loop;


    /* =====================================================
    ASSIGN RESPONSIBLE ROLES

    These rows satisfy the deferred "at least one role"
    constraint on admin.tasks.
    ===================================================== */

    insert into admin.task_responsible_roles (
        task_id,
        role_key,
        assigned_by_account_id
    )
    select
        v_task_id,
        requested_role,
        p_actor_account_id
    from unnest(
        v_responsible_roles
    ) as requested_role;


    /* =====================================================
    INITIAL AUDIT EVENT
    ===================================================== */

    insert into admin.task_events (
        task_id,
        actor_account_id,
        event_type,
        note,
        previous_data,
        new_data,
        metadata
    )
    values (
        v_task_id,
        p_actor_account_id,
        'created',
        v_note,
        null,
        jsonb_build_object(
            'taskCode',
                v_task_code,

            'title',
                v_title,

            'body',
                v_body,

            'priority',
                v_priority,

            'timelineDays',
                v_timeline_days,

            'responsibleRoles',
                to_jsonb(
                    v_responsible_roles
                ),

            'status',
                'To Do'
        ),
        jsonb_build_object(
            'source',
                'taskboard'
        )
    )
    returning id
    into v_event_id;


    /* =====================================================
    NORMALIZED RESULT

    Use task_board_view so returned data follows the same
    model that future list/read APIs will consume.

    JSON return allows fields to be extended later without
    requiring a new PostgreSQL return-table signature.
    ===================================================== */

    select
        jsonb_build_object(
            'id',
                task.id,

            'taskCode',
                task.task_code,

            'creatorAccountId',
                task.creator_account_id,

            'createdAt',
                task.created_at,

            'title',
                task.title,

            'body',
                task.body,

            'priority',
                task.priority,

            'timelineDays',
                task.timeline_days,

            'deadline',
                task.deadline,

            'responsibleRoles',
                to_jsonb(
                    task.responsible_roles
                ),

            'status',
                task.status,

            'isLate',
                task.is_late,

            'daysLate',
                task.days_late,

            'updatedAt',
                task.updated_at,

            'updatedByAccountId',
                task.updated_by_account_id,

            'version',
                task.version,

            'completedAt',
                task.completed_at,

            'shelvedAt',
                task.shelved_at,

            'shelvedUntil',
                task.shelved_until,

            'archivedAt',
                task.archived_at,

            'deletedAt',
                task.deleted_at,

            'eventId',
                v_event_id
        )
    into
        v_task
    from admin.task_board_view
        as task
    where task.id =
        v_task_id;


    if
        v_task is null
    then
        raise exception
            'The newly created task could not be resolved.'
            using errcode =
                'P0001';
    end if;


    /* =====================================================
    SUCCESS
    ===================================================== */

    return jsonb_build_object(
        'success',
            true,

        'task',
            v_task
    );

end;
$function$;
CREATE OR REPLACE FUNCTION api.admin_update_task(p_task_code text, p_expected_version bigint, p_changes jsonb, p_actor_account_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'admin', 'api', 'identity'
AS $function$
declare
    v_task_before admin.tasks%rowtype;
    v_task_after admin.tasks%rowtype;

    v_task_code text :=
        upper(
            btrim(
                coalesce(
                    p_task_code,
                    ''
                )
            )
        );

    v_changes jsonb :=
        coalesce(
            p_changes,
            '{}'::jsonb
        );

    v_allowed_keys constant text[] := array[
        'title',
        'description',
        'priority',
        'timeline',
        'assigned_role',
        'assigned_account_id'
    ];

    v_invalid_keys text[];

    v_before_json jsonb;
    v_after_json jsonb;
    v_changed_fields jsonb;

    v_now timestamptz :=
        statement_timestamp();
begin

/* =========================================================
INPUT VALIDATION
========================================================= */

    if v_task_code = '' then
        raise exception using
            errcode = '22023',
            message = 'TASK_CODE_REQUIRED',
            detail = 'A task code is required.';
    end if;

    if v_task_code !~ '^TASK-[A-HJ-NP-Z2-9]{6}$' then
        raise exception using
            errcode = '22023',
            message = 'TASK_CODE_INVALID',
            detail = 'The supplied task code is invalid.';
    end if;

    if p_expected_version is null
       or p_expected_version < 1 then
        raise exception using
            errcode = '22023',
            message = 'EXPECTED_VERSION_REQUIRED',
            detail = 'A valid expected task version is required.';
    end if;

    if p_actor_account_id is null then
        raise exception using
            errcode = '22023',
            message = 'ACTOR_REQUIRED',
            detail = 'The authenticated account is required.';
    end if;

    if jsonb_typeof(v_changes) <> 'object' then
        raise exception using
            errcode = '22023',
            message = 'TASK_CHANGES_INVALID',
            detail = 'Task changes must be a JSON object.';
    end if;

/* =========================================================
PATCH FIELD VALIDATION

Fail closed.

New database columns do not automatically become writable
through this RPC. They must deliberately be added here.
========================================================= */

    select
        array_agg(key order by key)
    into
        v_invalid_keys
    from
        jsonb_object_keys(
            v_changes
        ) as supplied(key)
    where
        not (
            supplied.key =
            any(v_allowed_keys)
        );

    if v_invalid_keys is not null then
        raise exception using
            errcode = '22023',
            message = 'TASK_FIELDS_NOT_EDITABLE',
            detail =
                'Unsupported task fields: '
                || array_to_string(
                    v_invalid_keys,
                    ', '
                );
    end if;

    if v_changes = '{}'::jsonb then
        raise exception using
            errcode = '22023',
            message = 'TASK_CHANGES_REQUIRED',
            detail = 'At least one task change is required.';
    end if;

/* =========================================================
BASIC VALUE VALIDATION

Database CHECK constraints remain the final authority for
priority, timeline and assignment rules.
========================================================= */

    if v_changes ? 'title' then
        if jsonb_typeof(
            v_changes -> 'title'
        ) <> 'string' then
            raise exception using
                errcode = '22023',
                message = 'TASK_TITLE_INVALID';
        end if;

        if btrim(
            v_changes ->> 'title'
        ) = '' then
            raise exception using
                errcode = '22023',
                message = 'TASK_TITLE_REQUIRED';
        end if;
    end if;

    if v_changes ? 'description'
       and jsonb_typeof(
            v_changes -> 'description'
       ) not in (
            'string',
            'null'
       ) then
        raise exception using
            errcode = '22023',
            message = 'TASK_DESCRIPTION_INVALID';
    end if;

    if v_changes ? 'priority'
       and jsonb_typeof(
            v_changes -> 'priority'
       ) <> 'string' then
        raise exception using
            errcode = '22023',
            message = 'TASK_PRIORITY_INVALID';
    end if;

    if v_changes ? 'timeline'
       and jsonb_typeof(
            v_changes -> 'timeline'
       ) <> 'string' then
        raise exception using
            errcode = '22023',
            message = 'TASK_TIMELINE_INVALID';
    end if;

    if v_changes ? 'assigned_role'
       and jsonb_typeof(
            v_changes -> 'assigned_role'
       ) not in (
            'string',
            'null'
       ) then
        raise exception using
            errcode = '22023',
            message = 'TASK_ASSIGNED_ROLE_INVALID';
    end if;

/* =========================================================
LOAD CURRENT TASK

This first read is used for:
- not-found detection
- conflict reporting
- before-state audit data

The UPDATE below still performs the actual concurrency check.
========================================================= */

    select
        *
    into
        v_task_before
    from
        admin.tasks
    where
        task_code = v_task_code;

    if not found then
        raise exception using
            errcode = 'P0002',
            message = 'TASK_NOT_FOUND',
            detail = 'No task exists with code ' || v_task_code || '.';
    end if;

/* =========================================================
OPTIMISTIC CONCURRENCY PRECHECK
========================================================= */

    if v_task_before.version <> p_expected_version then
        raise exception using
            errcode = '40001',
            message = 'TASK_VERSION_CONFLICT',
            detail = format(
                'Expected version %s but current version is %s.',
                p_expected_version,
                v_task_before.version
            ),
            hint =
                'Reload the task and reapply the changes to the current version.';
    end if;

/* =========================================================
PROTECTED LIFECYCLE STATE

General edits should not resurrect or mutate records that have
already entered protected lifecycle states.

Dedicated lifecycle RPCs should own these transitions.
========================================================= */

    if v_task_before.deleted_at is not null then
        raise exception using
            errcode = '55000',
            message = 'TASK_DELETED',
            detail = 'Deleted tasks cannot be edited.';
    end if;

    if v_task_before.archived_at is not null then
        raise exception using
            errcode = '55000',
            message = 'TASK_ARCHIVED',
            detail = 'Archived tasks cannot be edited.';
    end if;

/* =========================================================
ATOMIC UPDATE + VERSION GUARD

Presence of a JSON key means "update this property."

This preserves the important distinction between:
- omitted property
- explicit JSON null
========================================================= */

    update
        admin.tasks
    set
        title =
            case
                when v_changes ? 'title'
                then btrim(
                    v_changes ->> 'title'
                )
                else title
            end,

        description =
            case
                when v_changes ? 'description'
                then nullif(
                    btrim(
                        v_changes ->> 'description'
                    ),
                    ''
                )
                else description
            end,

        priority =
            case
                when v_changes ? 'priority'
                then lower(
                    btrim(
                        v_changes ->> 'priority'
                    )
                )
                else priority
            end,

        timeline =
            case
                when v_changes ? 'timeline'
                then lower(
                    btrim(
                        v_changes ->> 'timeline'
                    )
                )
                else timeline
            end,

        assigned_role =
            case
                when v_changes ? 'assigned_role'
                then nullif(
                    lower(
                        btrim(
                            v_changes ->> 'assigned_role'
                        )
                    ),
                    ''
                )
                else assigned_role
            end,

        assigned_account_id =
            case
                when v_changes ? 'assigned_account_id'
                then
                    case
                        when v_changes -> 'assigned_account_id' =
                             'null'::jsonb
                        then null

                        else (
                            v_changes ->> 'assigned_account_id'
                        )::uuid
                    end
                else assigned_account_id
            end,

        updated_at =
            v_now,

        version =
            version + 1

    where
        id = v_task_before.id
        and version = p_expected_version

    returning
        *
    into
        v_task_after;

/* =========================================================
FINAL CONCURRENCY CHECK

Another writer could have changed the task after our initial
SELECT but before our UPDATE.

The version predicate makes that stale write impossible.
========================================================= */

    if not found then
        raise exception using
            errcode = '40001',
            message = 'TASK_VERSION_CONFLICT',
            detail =
                'The task changed while this update was being processed.',
            hint =
                'Reload the task and retry using its latest version.';
    end if;

/* =========================================================
NO-OP DETECTION

Ignore infrastructure-controlled properties when deciding
whether the task itself materially changed.

A no-op should not consume a version.
========================================================= */

    v_before_json :=
        to_jsonb(
            v_task_before
        )
        - 'version'
        - 'updated_at';

    v_after_json :=
        to_jsonb(
            v_task_after
        )
        - 'version'
        - 'updated_at';

    if v_before_json = v_after_json then

        /*
        Restore the original version/update timestamp.

        Because this entire function executes transactionally,
        nothing outside this transaction can observe the
        temporary increment.
        */

        update
            admin.tasks
        set
            version =
                v_task_before.version,
            updated_at =
                v_task_before.updated_at
        where
            id = v_task_before.id
            and version = v_task_after.version
        returning
            *
        into
            v_task_after;

        return jsonb_build_object(
            'success', true,
            'changed', false,
            'task', to_jsonb(v_task_after),
            'version', v_task_after.version
        );
    end if;

/* =========================================================
AUDIT DELTA

Stores only properties whose persisted values actually changed.
========================================================= */

    select
        coalesce(
            jsonb_object_agg(
                key,
                jsonb_build_object(
                    'before',
                    v_before_json -> key,
                    'after',
                    v_after_json -> key
                )
            ),
            '{}'::jsonb
        )
    into
        v_changed_fields
    from (
        select key
        from jsonb_object_keys(
            v_before_json || v_after_json
        ) as keys(key)
        where
            v_before_json -> key
            is distinct from
            v_after_json -> key
    ) changed;

/* =========================================================
AUDIT EVENT

If your existing admin.task_events foundation uses different
names for these audit columns, preserve its exact names here.

The important persisted information is:
- task
- actor
- event type
- old version
- new version
- actual changed properties
========================================================= */

    insert into admin.task_events (
        task_id,
        event_type,
        actor_account_id,
        previous_version,
        resulting_version,
        changes,
        created_at
    )
    values (
        v_task_after.id,
        'updated',
        p_actor_account_id,
        v_task_before.version,
        v_task_after.version,
        v_changed_fields,
        v_now
    );

/* =========================================================
AUTHORITATIVE RESPONSE
========================================================= */

    return jsonb_build_object(
        'success', true,
        'changed', true,
        'task', to_jsonb(v_task_after),
        'version', v_task_after.version,
        'previousVersion', v_task_before.version,
        'changes', v_changed_fields
    );
end;
$function$;
CREATE OR REPLACE FUNCTION api.admin_complete_task(p_task_code text, p_expected_version bigint, p_actor_account_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'admin', 'api', 'identity'
AS $function$
declare
    v_task_before admin.tasks%rowtype;
    v_task_after admin.tasks%rowtype;
    v_task_code text :=
        upper(
            btrim(
                coalesce(
                    p_task_code,
                    ''
                )
            )
        );
    v_completed_at timestamptz :=
        statement_timestamp();
begin

/* =========================================================
INPUT VALIDATION
========================================================= */

    if v_task_code = '' then
        raise exception using
            errcode = '22023',
            message = 'TASK_CODE_REQUIRED',
            detail = 'A task code is required.';
    end if;

    if v_task_code !~ '^TASK-[A-HJ-NP-Z2-9]{6}$' then
        raise exception using
            errcode = '22023',
            message = 'TASK_CODE_INVALID',
            detail = 'The supplied task code is invalid.';
    end if;

    if p_expected_version is null
       or p_expected_version < 1 then
        raise exception using
            errcode = '22023',
            message = 'EXPECTED_VERSION_REQUIRED',
            detail = 'A valid expected task version is required.';
    end if;

    if p_actor_account_id is null then
        raise exception using
            errcode = '22023',
            message = 'ACTOR_REQUIRED',
            detail = 'The authenticated account is required.';
    end if;

/* =========================================================
LOAD CURRENT TASK

Used for:
- not-found detection
- lifecycle validation
- useful concurrency errors
- before-state audit information

The UPDATE below still performs the authoritative version
comparison atomically.
========================================================= */

    select
        *
    into
        v_task_before
    from
        admin.tasks
    where
        task_code = v_task_code;

    if not found then
        raise exception using
            errcode = 'P0002',
            message = 'TASK_NOT_FOUND',
            detail =
                'No task exists with code '
                || v_task_code
                || '.';
    end if;

/* =========================================================
OPTIMISTIC CONCURRENCY PRECHECK
========================================================= */

    if v_task_before.version <> p_expected_version then
        raise exception using
            errcode = '40001',
            message = 'TASK_VERSION_CONFLICT',
            detail = format(
                'Expected version %s but current version is %s.',
                p_expected_version,
                v_task_before.version
            ),
            hint =
                'Reload the task before completing it.';
    end if;

/* =========================================================
LIFECYCLE VALIDATION

Completion is only valid from the normal active state.

Dedicated lifecycle RPCs own restoration, shelving,
archiving, and deletion transitions.
========================================================= */

    if v_task_before.deleted_at is not null then
        raise exception using
            errcode = '55000',
            message = 'TASK_DELETED',
            detail =
                'Deleted tasks cannot be completed.';
    end if;

    if v_task_before.archived_at is not null then
        raise exception using
            errcode = '55000',
            message = 'TASK_ARCHIVED',
            detail =
                'Archived tasks cannot be completed.';
    end if;

    if v_task_before.shelved_at is not null then
        raise exception using
            errcode = '55000',
            message = 'TASK_SHELVED',
            detail =
                'Shelved tasks must be unshelved before completion.';
    end if;

    if v_task_before.completed_at is not null then
        raise exception using
            errcode = '55000',
            message = 'TASK_ALREADY_COMPLETED',
            detail =
                'This task has already been completed.';
    end if;

/* =========================================================
ATOMIC COMPLETION

The version predicate protects against another staff member
changing the task after the SELECT above.
========================================================= */

    update
        admin.tasks
    set
        completed_at =
            v_completed_at,
        updated_at =
            v_completed_at,
        version =
            version + 1
    where
        id = v_task_before.id
        and version = p_expected_version
        and completed_at is null
        and shelved_at is null
        and archived_at is null
        and deleted_at is null
    returning
        *
    into
        v_task_after;

/* =========================================================
FINAL CONCURRENCY GUARD
========================================================= */

    if not found then
        raise exception using
            errcode = '40001',
            message = 'TASK_VERSION_CONFLICT',
            detail =
                'The task changed while completion was being processed.',
            hint =
                'Reload the task and retry with its current version.';
    end if;

/* =========================================================
AUDIT EVENT

Completion and event creation occur in one transaction.
Failure of either causes the entire RPC to roll back.
========================================================= */

    insert into admin.task_events (
        task_id,
        event_type,
        actor_account_id,
        previous_version,
        resulting_version,
        changes,
        created_at
    )
    values (
        v_task_after.id,
        'completed',
        p_actor_account_id,
        v_task_before.version,
        v_task_after.version,
        jsonb_build_object(
            'completed_at',
            jsonb_build_object(
                'before',
                to_jsonb(
                    v_task_before.completed_at
                ),
                'after',
                to_jsonb(
                    v_task_after.completed_at
                )
            )
        ),
        v_completed_at
    );

/* =========================================================
AUTHORITATIVE RESPONSE
========================================================= */

    return jsonb_build_object(
        'success', true,
        'changed', true,
        'task', to_jsonb(v_task_after),
        'previousVersion',
            v_task_before.version,
        'version',
            v_task_after.version
    );
end;
$function$;
CREATE OR REPLACE FUNCTION api.admin_reopen_task(p_task_code text, p_expected_version bigint, p_actor_account_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'admin', 'api', 'identity'
AS $function$
declare
    v_task_before admin.tasks%rowtype;
    v_task_after admin.tasks%rowtype;
    v_task_code text :=
        upper(
            btrim(
                coalesce(
                    p_task_code,
                    ''
                )
            )
        );
    v_reopened_at timestamptz :=
        statement_timestamp();
begin

/* =========================================================
INPUT VALIDATION
========================================================= */

    if v_task_code = '' then
        raise exception using
            errcode = '22023',
            message = 'TASK_CODE_REQUIRED',
            detail = 'A task code is required.';
    end if;

    if v_task_code !~ '^TASK-[A-HJ-NP-Z2-9]{6}$' then
        raise exception using
            errcode = '22023',
            message = 'TASK_CODE_INVALID',
            detail = 'The supplied task code is invalid.';
    end if;

    if p_expected_version is null
       or p_expected_version < 1 then
        raise exception using
            errcode = '22023',
            message = 'EXPECTED_VERSION_REQUIRED',
            detail = 'A valid expected task version is required.';
    end if;

    if p_actor_account_id is null then
        raise exception using
            errcode = '22023',
            message = 'ACTOR_REQUIRED',
            detail = 'The authenticated account is required.';
    end if;

/* =========================================================
LOAD CURRENT TASK
========================================================= */

    select
        *
    into
        v_task_before
    from
        admin.tasks
    where
        task_code = v_task_code;

    if not found then
        raise exception using
            errcode = 'P0002',
            message = 'TASK_NOT_FOUND',
            detail =
                'No task exists with code '
                || v_task_code
                || '.';
    end if;

/* =========================================================
OPTIMISTIC CONCURRENCY PRECHECK
========================================================= */

    if v_task_before.version <> p_expected_version then
        raise exception using
            errcode = '40001',
            message = 'TASK_VERSION_CONFLICT',
            detail = format(
                'Expected version %s but current version is %s.',
                p_expected_version,
                v_task_before.version
            ),
            hint =
                'Reload the task before reopening it.';
    end if;

/* =========================================================
LIFECYCLE VALIDATION

Reopen only reverses completion.

Other lifecycle states must be handled by their dedicated
RPCs so transitions remain explicit and auditable.
========================================================= */

    if v_task_before.deleted_at is not null then
        raise exception using
            errcode = '55000',
            message = 'TASK_DELETED',
            detail =
                'Deleted tasks cannot be reopened.';
    end if;

    if v_task_before.archived_at is not null then
        raise exception using
            errcode = '55000',
            message = 'TASK_ARCHIVED',
            detail =
                'Archived tasks must be restored before they can be reopened.';
    end if;

    if v_task_before.shelved_at is not null then
        raise exception using
            errcode = '55000',
            message = 'TASK_SHELVED',
            detail =
                'Shelved tasks must be unshelved before they can be reopened.';
    end if;

    if v_task_before.completed_at is null then
        raise exception using
            errcode = '55000',
            message = 'TASK_NOT_COMPLETED',
            detail =
                'Only completed tasks can be reopened.';
    end if;

/* =========================================================
ATOMIC REOPEN

The version predicate handles a race between the SELECT above
and this UPDATE.
========================================================= */

    update
        admin.tasks
    set
        completed_at = null,
        updated_at = v_reopened_at,
        version = version + 1
    where
        id = v_task_before.id
        and version = p_expected_version
        and completed_at is not null
        and shelved_at is null
        and archived_at is null
        and deleted_at is null
    returning
        *
    into
        v_task_after;

/* =========================================================
FINAL CONCURRENCY GUARD
========================================================= */

    if not found then
        raise exception using
            errcode = '40001',
            message = 'TASK_VERSION_CONFLICT',
            detail =
                'The task changed while reopening was being processed.',
            hint =
                'Reload the task and retry with its current version.';
    end if;

/* =========================================================
AUDIT EVENT
========================================================= */

    insert into admin.task_events (
        task_id,
        event_type,
        actor_account_id,
        previous_version,
        resulting_version,
        changes,
        created_at
    )
    values (
        v_task_after.id,
        'reopened',
        p_actor_account_id,
        v_task_before.version,
        v_task_after.version,
        jsonb_build_object(
            'completed_at',
            jsonb_build_object(
                'before',
                to_jsonb(
                    v_task_before.completed_at
                ),
                'after',
                'null'::jsonb
            )
        ),
        v_reopened_at
    );

/* =========================================================
AUTHORITATIVE RESPONSE
========================================================= */

    return jsonb_build_object(
        'success', true,
        'changed', true,
        'task', to_jsonb(v_task_after),
        'previousVersion',
            v_task_before.version,
        'version',
            v_task_after.version
    );
end;
$function$;
CREATE OR REPLACE FUNCTION api.admin_shelve_task(p_task_code text, p_expected_version bigint, p_actor_account_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'admin', 'api', 'identity'
AS $function$
declare
    v_task_before admin.tasks%rowtype;
    v_task_after admin.tasks%rowtype;
    v_task_code text :=
        upper(
            btrim(
                coalesce(
                    p_task_code,
                    ''
                )
            )
        );
    v_shelved_at timestamptz :=
        statement_timestamp();
begin

/* =========================================================
INPUT VALIDATION
========================================================= */

    if v_task_code = '' then
        raise exception using
            errcode = '22023',
            message = 'TASK_CODE_REQUIRED',
            detail = 'A task code is required.';
    end if;

    if v_task_code !~ '^TASK-[A-HJ-NP-Z2-9]{6}$' then
        raise exception using
            errcode = '22023',
            message = 'TASK_CODE_INVALID',
            detail = 'The supplied task code is invalid.';
    end if;

    if p_expected_version is null
       or p_expected_version < 1 then
        raise exception using
            errcode = '22023',
            message = 'EXPECTED_VERSION_REQUIRED',
            detail = 'A valid expected task version is required.';
    end if;

    if p_actor_account_id is null then
        raise exception using
            errcode = '22023',
            message = 'ACTOR_REQUIRED',
            detail = 'The authenticated account is required.';
    end if;

/* =========================================================
LOAD CURRENT TASK
========================================================= */

    select
        *
    into
        v_task_before
    from
        admin.tasks
    where
        task_code = v_task_code;

    if not found then
        raise exception using
            errcode = 'P0002',
            message = 'TASK_NOT_FOUND',
            detail =
                'No task exists with code '
                || v_task_code
                || '.';
    end if;

/* =========================================================
OPTIMISTIC CONCURRENCY PRECHECK
========================================================= */

    if v_task_before.version <> p_expected_version then
        raise exception using
            errcode = '40001',
            message = 'TASK_VERSION_CONFLICT',
            detail = format(
                'Expected version %s but current version is %s.',
                p_expected_version,
                v_task_before.version
            ),
            hint =
                'Reload the task before shelving it.';
    end if;

/* =========================================================
LIFECYCLE VALIDATION
========================================================= */

    if v_task_before.deleted_at is not null then
        raise exception using
            errcode = '55000',
            message = 'TASK_DELETED',
            detail =
                'Deleted tasks cannot be shelved.';
    end if;

    if v_task_before.archived_at is not null then
        raise exception using
            errcode = '55000',
            message = 'TASK_ARCHIVED',
            detail =
                'Archived tasks cannot be shelved.';
    end if;

    if v_task_before.completed_at is not null then
        raise exception using
            errcode = '55000',
            message = 'TASK_COMPLETED',
            detail =
                'Completed tasks cannot be shelved. Reopen the task first.';
    end if;

    if v_task_before.shelved_at is not null then
        raise exception using
            errcode = '55000',
            message = 'TASK_ALREADY_SHELVED',
            detail =
                'This task is already shelved.';
    end if;

/* =========================================================
ATOMIC SHELVE
========================================================= */

    update
        admin.tasks
    set
        shelved_at = v_shelved_at,
        updated_at = v_shelved_at,
        version = version + 1
    where
        id = v_task_before.id
        and version = p_expected_version
        and shelved_at is null
        and completed_at is null
        and archived_at is null
        and deleted_at is null
    returning
        *
    into
        v_task_after;

/* =========================================================
FINAL CONCURRENCY GUARD
========================================================= */

    if not found then
        raise exception using
            errcode = '40001',
            message = 'TASK_VERSION_CONFLICT',
            detail =
                'The task changed while shelving was being processed.',
            hint =
                'Reload the task and retry with its current version.';
    end if;

/* =========================================================
AUDIT EVENT
========================================================= */

    insert into admin.task_events (
        task_id,
        event_type,
        actor_account_id,
        previous_version,
        resulting_version,
        changes,
        created_at
    )
    values (
        v_task_after.id,
        'shelved',
        p_actor_account_id,
        v_task_before.version,
        v_task_after.version,
        jsonb_build_object(
            'shelved_at',
            jsonb_build_object(
                'before',
                to_jsonb(
                    v_task_before.shelved_at
                ),
                'after',
                to_jsonb(
                    v_task_after.shelved_at
                )
            )
        ),
        v_shelved_at
    );

/* =========================================================
AUTHORITATIVE RESPONSE
========================================================= */

    return jsonb_build_object(
        'success', true,
        'changed', true,
        'task', to_jsonb(v_task_after),
        'previousVersion',
            v_task_before.version,
        'version',
            v_task_after.version
    );
end;
$function$;
CREATE OR REPLACE FUNCTION api.admin_unshelve_task(p_task_code text, p_expected_version bigint, p_actor_account_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'admin', 'api', 'identity'
AS $function$
declare
    v_task_before admin.tasks%rowtype;
    v_task_after admin.tasks%rowtype;
    v_task_code text :=
        upper(
            btrim(
                coalesce(
                    p_task_code,
                    ''
                )
            )
        );
    v_unshelved_at timestamptz :=
        statement_timestamp();
begin

/* =========================================================
INPUT VALIDATION
========================================================= */

    if v_task_code = '' then
        raise exception using
            errcode = '22023',
            message = 'TASK_CODE_REQUIRED',
            detail = 'A task code is required.';
    end if;

    if v_task_code !~ '^TASK-[A-HJ-NP-Z2-9]{6}$' then
        raise exception using
            errcode = '22023',
            message = 'TASK_CODE_INVALID',
            detail = 'The supplied task code is invalid.';
    end if;

    if p_expected_version is null
       or p_expected_version < 1 then
        raise exception using
            errcode = '22023',
            message = 'EXPECTED_VERSION_REQUIRED',
            detail = 'A valid expected task version is required.';
    end if;

    if p_actor_account_id is null then
        raise exception using
            errcode = '22023',
            message = 'ACTOR_REQUIRED',
            detail = 'The authenticated account is required.';
    end if;

/* =========================================================
LOAD CURRENT TASK
========================================================= */

    select
        *
    into
        v_task_before
    from
        admin.tasks
    where
        task_code = v_task_code;

    if not found then
        raise exception using
            errcode = 'P0002',
            message = 'TASK_NOT_FOUND',
            detail =
                'No task exists with code '
                || v_task_code
                || '.';
    end if;

/* =========================================================
OPTIMISTIC CONCURRENCY PRECHECK
========================================================= */

    if v_task_before.version <> p_expected_version then
        raise exception using
            errcode = '40001',
            message = 'TASK_VERSION_CONFLICT',
            detail = format(
                'Expected version %s but current version is %s.',
                p_expected_version,
                v_task_before.version
            ),
            hint =
                'Reload the task before unshelving it.';
    end if;

/* =========================================================
LIFECYCLE VALIDATION
========================================================= */

    if v_task_before.deleted_at is not null then
        raise exception using
            errcode = '55000',
            message = 'TASK_DELETED',
            detail =
                'Deleted tasks cannot be unshelved.';
    end if;

    if v_task_before.archived_at is not null then
        raise exception using
            errcode = '55000',
            message = 'TASK_ARCHIVED',
            detail =
                'Archived tasks must be restored before they can be unshelved.';
    end if;

    if v_task_before.completed_at is not null then
        raise exception using
            errcode = '55000',
            message = 'TASK_COMPLETED',
            detail =
                'Completed tasks cannot be unshelved.';
    end if;

    if v_task_before.shelved_at is null then
        raise exception using
            errcode = '55000',
            message = 'TASK_NOT_SHELVED',
            detail =
                'Only shelved tasks can be unshelved.';
    end if;

/* =========================================================
ATOMIC UNSHELVE
========================================================= */

    update
        admin.tasks
    set
        shelved_at = null,
        updated_at = v_unshelved_at,
        version = version + 1
    where
        id = v_task_before.id
        and version = p_expected_version
        and shelved_at is not null
        and completed_at is null
        and archived_at is null
        and deleted_at is null
    returning
        *
    into
        v_task_after;

/* =========================================================
FINAL CONCURRENCY GUARD
========================================================= */

    if not found then
        raise exception using
            errcode = '40001',
            message = 'TASK_VERSION_CONFLICT',
            detail =
                'The task changed while unshelving was being processed.',
            hint =
                'Reload the task and retry with its current version.';
    end if;

/* =========================================================
AUDIT EVENT
========================================================= */

    insert into admin.task_events (
        task_id,
        event_type,
        actor_account_id,
        previous_version,
        resulting_version,
        changes,
        created_at
    )
    values (
        v_task_after.id,
        'unshelved',
        p_actor_account_id,
        v_task_before.version,
        v_task_after.version,
        jsonb_build_object(
            'shelved_at',
            jsonb_build_object(
                'before',
                to_jsonb(
                    v_task_before.shelved_at
                ),
                'after',
                'null'::jsonb
            )
        ),
        v_unshelved_at
    );

/* =========================================================
AUTHORITATIVE RESPONSE
========================================================= */

    return jsonb_build_object(
        'success', true,
        'changed', true,
        'task', to_jsonb(v_task_after),
        'previousVersion',
            v_task_before.version,
        'version',
            v_task_after.version
    );
end;
$function$;
CREATE OR REPLACE FUNCTION api.admin_archive_task(p_task_code text, p_expected_version bigint, p_actor_account_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'admin', 'api', 'identity'
AS $function$
declare
    v_task_before admin.tasks%rowtype;
    v_task_after admin.tasks%rowtype;
    v_task_code text :=
        upper(
            btrim(
                coalesce(
                    p_task_code,
                    ''
                )
            )
        );
    v_archived_at timestamptz :=
        statement_timestamp();
begin

/* =========================================================
INPUT VALIDATION
========================================================= */

    if v_task_code = '' then
        raise exception using
            errcode = '22023',
            message = 'TASK_CODE_REQUIRED',
            detail = 'A task code is required.';
    end if;

    if v_task_code !~ '^TASK-[A-HJ-NP-Z2-9]{6}$' then
        raise exception using
            errcode = '22023',
            message = 'TASK_CODE_INVALID',
            detail = 'The supplied task code is invalid.';
    end if;

    if p_expected_version is null
       or p_expected_version < 1 then
        raise exception using
            errcode = '22023',
            message = 'EXPECTED_VERSION_REQUIRED',
            detail = 'A valid expected task version is required.';
    end if;

    if p_actor_account_id is null then
        raise exception using
            errcode = '22023',
            message = 'ACTOR_REQUIRED',
            detail = 'The authenticated account is required.';
    end if;

/* =========================================================
LOAD CURRENT TASK
========================================================= */

    select
        *
    into
        v_task_before
    from
        admin.tasks
    where
        task_code = v_task_code;

    if not found then
        raise exception using
            errcode = 'P0002',
            message = 'TASK_NOT_FOUND',
            detail =
                'No task exists with code '
                || v_task_code
                || '.';
    end if;

/* =========================================================
OPTIMISTIC CONCURRENCY PRECHECK
========================================================= */

    if v_task_before.version <> p_expected_version then
        raise exception using
            errcode = '40001',
            message = 'TASK_VERSION_CONFLICT',
            detail = format(
                'Expected version %s but current version is %s.',
                p_expected_version,
                v_task_before.version
            ),
            hint =
                'Reload the task before archiving it.';
    end if;

/* =========================================================
LIFECYCLE VALIDATION
========================================================= */

    if v_task_before.deleted_at is not null then
        raise exception using
            errcode = '55000',
            message = 'TASK_DELETED',
            detail =
                'Deleted tasks cannot be archived.';
    end if;

    if v_task_before.archived_at is not null then
        raise exception using
            errcode = '55000',
            message = 'TASK_ALREADY_ARCHIVED',
            detail =
                'This task is already archived.';
    end if;

/* =========================================================
ATOMIC ARCHIVE

Archiving intentionally preserves completed_at and shelved_at
so historical state is not destroyed.
========================================================= */

    update
        admin.tasks
    set
        archived_at = v_archived_at,
        updated_at = v_archived_at,
        version = version + 1
    where
        id = v_task_before.id
        and version = p_expected_version
        and archived_at is null
        and deleted_at is null
    returning
        *
    into
        v_task_after;

/* =========================================================
FINAL CONCURRENCY GUARD
========================================================= */

    if not found then
        raise exception using
            errcode = '40001',
            message = 'TASK_VERSION_CONFLICT',
            detail =
                'The task changed while archiving was being processed.',
            hint =
                'Reload the task and retry with its current version.';
    end if;

/* =========================================================
AUDIT EVENT
========================================================= */

    insert into admin.task_events (
        task_id,
        event_type,
        actor_account_id,
        previous_version,
        resulting_version,
        changes,
        created_at
    )
    values (
        v_task_after.id,
        'archived',
        p_actor_account_id,
        v_task_before.version,
        v_task_after.version,
        jsonb_build_object(
            'archived_at',
            jsonb_build_object(
                'before',
                to_jsonb(
                    v_task_before.archived_at
                ),
                'after',
                to_jsonb(
                    v_task_after.archived_at
                )
            )
        ),
        v_archived_at
    );

/* =========================================================
AUTHORITATIVE RESPONSE
========================================================= */

    return jsonb_build_object(
        'success', true,
        'changed', true,
        'task', to_jsonb(v_task_after),
        'previousVersion',
            v_task_before.version,
        'version',
            v_task_after.version
    );
end;
$function$;
CREATE OR REPLACE FUNCTION api.admin_restore_archived_task(p_task_code text, p_expected_version bigint, p_actor_account_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'admin', 'api', 'identity'
AS $function$
declare
    v_task_before admin.tasks%rowtype;
    v_task_after admin.tasks%rowtype;
    v_task_code text :=
        upper(
            btrim(
                coalesce(
                    p_task_code,
                    ''
                )
            )
        );
    v_restored_at timestamptz :=
        statement_timestamp();
begin

/* =========================================================
INPUT VALIDATION
========================================================= */

    if v_task_code = '' then
        raise exception using
            errcode = '22023',
            message = 'TASK_CODE_REQUIRED',
            detail = 'A task code is required.';
    end if;

    if v_task_code !~ '^TASK-[A-HJ-NP-Z2-9]{6}$' then
        raise exception using
            errcode = '22023',
            message = 'TASK_CODE_INVALID',
            detail = 'The supplied task code is invalid.';
    end if;

    if p_expected_version is null
       or p_expected_version < 1 then
        raise exception using
            errcode = '22023',
            message = 'EXPECTED_VERSION_REQUIRED',
            detail = 'A valid expected task version is required.';
    end if;

    if p_actor_account_id is null then
        raise exception using
            errcode = '22023',
            message = 'ACTOR_REQUIRED',
            detail = 'The authenticated account is required.';
    end if;

/* =========================================================
LOAD CURRENT TASK
========================================================= */

    select
        *
    into
        v_task_before
    from
        admin.tasks
    where
        task_code = v_task_code;

    if not found then
        raise exception using
            errcode = 'P0002',
            message = 'TASK_NOT_FOUND',
            detail =
                'No task exists with code '
                || v_task_code
                || '.';
    end if;

/* =========================================================
OPTIMISTIC CONCURRENCY PRECHECK
========================================================= */

    if v_task_before.version <> p_expected_version then
        raise exception using
            errcode = '40001',
            message = 'TASK_VERSION_CONFLICT',
            detail = format(
                'Expected version %s but current version is %s.',
                p_expected_version,
                v_task_before.version
            ),
            hint =
                'Reload the task before restoring it.';
    end if;

/* =========================================================
LIFECYCLE VALIDATION
========================================================= */

    if v_task_before.deleted_at is not null then
        raise exception using
            errcode = '55000',
            message = 'TASK_DELETED',
            detail =
                'Deleted tasks must be restored through the deleted-task restore operation.';
    end if;

    if v_task_before.archived_at is null then
        raise exception using
            errcode = '55000',
            message = 'TASK_NOT_ARCHIVED',
            detail =
                'Only archived tasks can be restored from archive.';
    end if;

/* =========================================================
ATOMIC RESTORE

Restoring from archive clears only archived_at.

If the task was completed or shelved before archival, those
states remain intact and must be changed through their own
dedicated lifecycle RPCs.
========================================================= */

    update
        admin.tasks
    set
        archived_at = null,
        updated_at = v_restored_at,
        version = version + 1
    where
        id = v_task_before.id
        and version = p_expected_version
        and archived_at is not null
        and deleted_at is null
    returning
        *
    into
        v_task_after;

/* =========================================================
FINAL CONCURRENCY GUARD
========================================================= */

    if not found then
        raise exception using
            errcode = '40001',
            message = 'TASK_VERSION_CONFLICT',
            detail =
                'The task changed while archive restoration was being processed.',
            hint =
                'Reload the task and retry with its current version.';
    end if;

/* =========================================================
AUDIT EVENT
========================================================= */

    insert into admin.task_events (
        task_id,
        event_type,
        actor_account_id,
        previous_version,
        resulting_version,
        changes,
        created_at
    )
    values (
        v_task_after.id,
        'archive_restored',
        p_actor_account_id,
        v_task_before.version,
        v_task_after.version,
        jsonb_build_object(
            'archived_at',
            jsonb_build_object(
                'before',
                to_jsonb(
                    v_task_before.archived_at
                ),
                'after',
                'null'::jsonb
            )
        ),
        v_restored_at
    );

/* =========================================================
AUTHORITATIVE RESPONSE
========================================================= */

    return jsonb_build_object(
        'success', true,
        'changed', true,
        'task', to_jsonb(v_task_after),
        'previousVersion',
            v_task_before.version,
        'version',
            v_task_after.version
    );
end;
$function$;
CREATE OR REPLACE FUNCTION api.admin_delete_task(p_task_code text, p_expected_version bigint, p_actor_account_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'admin', 'api', 'identity'
AS $function$
declare
    v_task_before admin.tasks%rowtype;
    v_task_after admin.tasks%rowtype;
    v_task_code text :=
        upper(
            btrim(
                coalesce(
                    p_task_code,
                    ''
                )
            )
        );
    v_deleted_at timestamptz :=
        statement_timestamp();
begin

/* =========================================================
INPUT VALIDATION
========================================================= */

    if v_task_code = '' then
        raise exception using
            errcode = '22023',
            message = 'TASK_CODE_REQUIRED',
            detail = 'A task code is required.';
    end if;

    if v_task_code !~ '^TASK-[A-HJ-NP-Z2-9]{6}$' then
        raise exception using
            errcode = '22023',
            message = 'TASK_CODE_INVALID',
            detail = 'The supplied task code is invalid.';
    end if;

    if p_expected_version is null
       or p_expected_version < 1 then
        raise exception using
            errcode = '22023',
            message = 'EXPECTED_VERSION_REQUIRED',
            detail = 'A valid expected task version is required.';
    end if;

    if p_actor_account_id is null then
        raise exception using
            errcode = '22023',
            message = 'ACTOR_REQUIRED',
            detail = 'The authenticated account is required.';
    end if;

/* =========================================================
LOAD CURRENT TASK
========================================================= */

    select
        *
    into
        v_task_before
    from
        admin.tasks
    where
        task_code = v_task_code;

    if not found then
        raise exception using
            errcode = 'P0002',
            message = 'TASK_NOT_FOUND',
            detail =
                'No task exists with code '
                || v_task_code
                || '.';
    end if;

/* =========================================================
OPTIMISTIC CONCURRENCY PRECHECK
========================================================= */

    if v_task_before.version <> p_expected_version then
        raise exception using
            errcode = '40001',
            message = 'TASK_VERSION_CONFLICT',
            detail = format(
                'Expected version %s but current version is %s.',
                p_expected_version,
                v_task_before.version
            ),
            hint =
                'Reload the task before deleting it.';
    end if;

/* =========================================================
LIFECYCLE VALIDATION
========================================================= */

    if v_task_before.deleted_at is not null then
        raise exception using
            errcode = '55000',
            message = 'TASK_ALREADY_DELETED',
            detail =
                'This task has already been deleted.';
    end if;

/* =========================================================
ATOMIC SOFT DELETE

Only deleted_at changes.

Other lifecycle timestamps are preserved so restoration can
return the task to its exact previous lifecycle state.
========================================================= */

    update
        admin.tasks
    set
        deleted_at = v_deleted_at,
        updated_at = v_deleted_at,
        version = version + 1
    where
        id = v_task_before.id
        and version = p_expected_version
        and deleted_at is null
    returning
        *
    into
        v_task_after;

/* =========================================================
FINAL CONCURRENCY GUARD
========================================================= */

    if not found then
        raise exception using
            errcode = '40001',
            message = 'TASK_VERSION_CONFLICT',
            detail =
                'The task changed while deletion was being processed.',
            hint =
                'Reload the task and retry with its current version.';
    end if;

/* =========================================================
AUDIT EVENT
========================================================= */

    insert into admin.task_events (
        task_id,
        event_type,
        actor_account_id,
        previous_version,
        resulting_version,
        changes,
        created_at
    )
    values (
        v_task_after.id,
        'deleted',
        p_actor_account_id,
        v_task_before.version,
        v_task_after.version,
        jsonb_build_object(
            'deleted_at',
            jsonb_build_object(
                'before',
                to_jsonb(
                    v_task_before.deleted_at
                ),
                'after',
                to_jsonb(
                    v_task_after.deleted_at
                )
            )
        ),
        v_deleted_at
    );

/* =========================================================
AUTHORITATIVE RESPONSE
========================================================= */

    return jsonb_build_object(
        'success', true,
        'changed', true,
        'task', to_jsonb(v_task_after),
        'previousVersion',
            v_task_before.version,
        'version',
            v_task_after.version
    );
end;
$function$;
CREATE TRIGGER admin_tasks_deadline_trigger BEFORE INSERT OR UPDATE OF timeline_days, created_at ON admin.tasks FOR EACH ROW EXECUTE FUNCTION admin.set_task_deadline();
CREATE TRIGGER admin_tasks_task_code_trigger BEFORE INSERT ON admin.tasks FOR EACH ROW EXECUTE FUNCTION admin.ensure_unique_task_code();
CREATE TRIGGER admin_tasks_updated_at_trigger BEFORE UPDATE ON admin.tasks FOR EACH ROW EXECUTE FUNCTION admin.set_task_updated_at();
