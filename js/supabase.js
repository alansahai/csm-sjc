/**
 * supabase.js
 * Initializes the Supabase client and provides a Firebase-compatible shim
 * so all existing window.db / window.doc / window.getDoc / window.auth
 * call-sites continue to work without changes.
 *
 * Load order in HTML:
 *   1. <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
 *   2. <script src="/supabase.config.js"></script>
 *   3. <script src="js/supabase.js"></script>
 */

(function () {
    'use strict';

    // --- 0. Config validation ---
    const cfg = window.__SUPABASE_CONFIG__;
    if (!cfg || !cfg.url || !cfg.anonKey) {
        console.error('[supabase.js] __SUPABASE_CONFIG__ is missing or incomplete.');
        return;
    }

    // The Supabase UMD build exposes window.supabase = { createClient, … }
    // We capture createClient before we overwrite window.supabase with the client.
    const { createClient } = window.supabase;
    const _client = createClient(cfg.url, cfg.anonKey);

    // Expose the raw client for any code that wants direct Supabase access
    window.supabase    = _client;
    window.supabaseRaw = _client; // alias so it's never lost after shim overwrites window.supabase

    // =========================================================
    // TABLE & COLUMN MAPPINGS
    // =========================================================

    // Firestore collection name → Supabase table name
    const COLLECTION_TO_TABLE = {
        userRoles:              'user_roles',
        academicYears:          'academic_years',
        classes:                'classes',
        appConfig:              'app_config',
        students:               'students',
        enrollments:            'enrollments',
        classYearCounters:      'class_year_counters',
        sessions:               'sessions',
        assessments:            'assessments',
        attendance:             'attendance',
        scores:                 'scores',
        earlyAngelEntries:      'early_angel_entries',
        earlyAngelDailySummary: 'early_angel_daily_summary',
        earlyAngelLeaderboard:  'early_angel_leaderboard',
        vbs_portal:             'vbs_portals',
        vbsStudents:            'vbs_students',
        vbsAttendance:          'vbs_attendance',
        vbsReports:             'vbs_reports',
        announcements:          'announcements',
        homework:               'homework',
        homeworkSubmissions:    'homework_submissions',
        activityLogs:              'activity_logs',
        facultyClassAssignments:   'faculty_class_assignments',
    };

    // The primary key column for each table (most use "id")
    const TABLE_PK = {
        students: 'student_id',
        // all others default to 'id'
    };

    function getPKColumn(table) {
        return TABLE_PK[table] || 'id';
    }

    // camelCase → snake_case field mapping (Firestore → Supabase column names)
    const CAMEL_TO_SNAKE = {
        academicYearId:         'academic_year_id',
        classId:                'class_id',
        studentId:              'student_id',
        sessionId:              'session_id',
        assessmentId:           'assessment_id',
        homeworkId:             'homework_id',
        portalId:               'portal_id',
        vbsStudentId:           'vbs_student_id',
        fullName:               'full_name',
        firstName:              'first_name',
        lastName:               'last_name',
        registerNo:             'register_no',
        totalMarks:             'total_marks',
        noClassReason:          'no_class_reason',
        sessionDate:            'session_date',
        assessmentDate:         'assessment_date',
        entryDate:              'entry_date',
        entryTime:              'entry_time',
        entryCount:             'entry_count',
        pointsTotal:            'points_total',
        totalPoints:            'total_points',
        lastEntryDate:          'last_entry_date',
        lastUpdatedAt:          'last_updated_at',
        summaryDate:            'summary_date',
        createdBy:              'created_by',
        updatedBy:              'updated_by',
        createdAt:              'created_at',
        updatedAt:              'updated_at',
        promotedFromClass:      'promoted_from_class',
        promotedFromYear:       'promoted_from_year',
        promotedAt:             'promoted_at',
        migratedFromYearId:     'migrated_from_year_id',
        previousYearId:         'previous_year_id',
        migrationEnabled:       'migration_enabled',
        yearLabel:              'year_label',
        startDate:              'start_date',
        endDate:                'end_date',
        activeAcademicYearId:   'active_academic_year_id',
        earlyAngelEnabled:      'early_angel_enabled',
        vbsEnabled:             'vbs_enabled',
        displayName:            'display_name',
        onboardingCompleted:    'onboarding_completed',
        onboardingCompletedAt:  'onboarding_completed_at',
        onboardingVersion:      'onboarding_version',
        onboardingChecklist:    'onboarding_checklist',
        behaviorNote:           'behavior_note',
        behaviorVisibility:     'behavior_visibility',
        anbiyamName:            'anbiyam_name',
        receivedFirstCommunion: 'received_first_communion',
        receivedConfirmation:   'received_confirmation',
        fatherName:             'father_name',
        fatherPhone:            'father_phone',
        motherName:             'mother_name',
        motherPhone:            'mother_phone',
        emergencyName:          'emergency_name',
        emergencyPhone:         'emergency_phone',
        dueDate:                'due_date',
        expiresAt:              'expires_at',
        attachmentNote:         'attachment_note',
        submittedAt:            'submitted_at',
        vbsDate:                'vbs_date',
        vbsYear:                'vbs_year',
        studentName:            'student_name',
        reportType:             'report_type',
        reportDate:             'report_date',
        reportData:             'report_data',
        generatedAt:            'generated_at',
        generatedBy:            'generated_by',
        generatedByRole:        'generated_by_role',
        userEmail:              'user_email',
    };

    // Build the reverse map (snake_case → camelCase) at startup
    const SNAKE_TO_CAMEL = {};
    for (const [camel, snake] of Object.entries(CAMEL_TO_SNAKE)) {
        SNAKE_TO_CAMEL[snake] = camel;
    }

    function toSnake(key) {
        return CAMEL_TO_SNAKE[key]
            || key.replace(/([A-Z])/g, '_$1').toLowerCase();
    }

    function toCamel(key) {
        return SNAKE_TO_CAMEL[key]
            || key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    }

    // Sentinel object returned by serverTimestamp() / Firestore increment()
    const _TIMESTAMP_SENTINEL = { _isTimestamp: true };
    const _DELETE_SENTINEL    = { _isDeleteSentinel: true };

    function toRow(data) {
        if (!data || typeof data !== 'object') return data;
        const out = {};
        for (const [k, v] of Object.entries(data)) {
            if (v === undefined) continue;
            const col = toSnake(k);
            if (v && typeof v === 'object' && v._isTimestamp) {
                out[col] = new Date().toISOString();
            } else if (v && typeof v === 'object' && v._isDeleteSentinel) {
                out[col] = null; // deleteField() → set column to NULL
            } else if (v && typeof v === 'object' && v._isIncrement) {
                // increment() sentinel — handled specially in updateDoc
                out[col] = v;
            } else {
                out[col] = v;
            }
        }
        return out;
    }

    function fromRow(row, table) {
        if (!row || typeof row !== 'object') return row;
        const out = {};
        for (const [k, v] of Object.entries(row)) {
            out[toCamel(k)] = v;
        }
        // Ensure the app always sees an 'id' field regardless of PK column name
        const pkCol = getPKColumn(table);
        if (pkCol !== 'id' && row[pkCol] !== undefined && out.id === undefined) {
            out.id = row[pkCol];
        }
        // Alias sessionDate → date so legacy code (session.date) keeps working
        if (out.sessionDate !== undefined && out.date === undefined) {
            out.date = out.sessionDate;
        }
        // Alias assessmentDate → date for assessments
        if (out.assessmentDate !== undefined && out.date === undefined) {
            out.date = out.assessmentDate;
        }
        return out;
    }

    // Build a Firestore-style doc reference (what window.doc returns) so snapshot
    // docs can expose `.ref` for batch.delete(doc.ref) / setDoc(doc.ref, …) call-sites.
    function makeDocRef(table, id) {
        return { _client, _table: table, _collection: table, _id: id, _type: 'doc' };
    }

    function makeDocSnap(data, table, id) {
        const converted = data ? fromRow(data, table) : null;
        return {
            exists:  ()  => !!data,
            data:    ()  => converted,
            id,
            ref:     makeDocRef(table, id),
        };
    }

    function makeQuerySnap(rows, table) {
        const docs = rows.map(row => {
            const pkCol  = getPKColumn(table);
            const docId  = row[pkCol] ?? row.id;
            const converted = fromRow(row, table);
            return {
                id:     docId,
                exists: () => true,
                data:   () => converted,
                ref:    makeDocRef(table, docId),
            };
        });
        return {
            empty:   docs.length === 0,
            docs,
            forEach: fn => docs.forEach(fn),
        };
    }

    // =========================================================
    // REFERENCE OBJECTS  (mimic Firestore doc/collection refs)
    // =========================================================

    window.doc = function (dbOrClient, collectionName, id) {
        const table = COLLECTION_TO_TABLE[collectionName] || collectionName;
        return { _client: _client, _table: table, _collection: collectionName, _id: id, _type: 'doc' };
    };

    window.collection = function (dbOrClient, collectionName) {
        const table = COLLECTION_TO_TABLE[collectionName] || collectionName;
        return { _client: _client, _table: table, _collection: collectionName, _type: 'collection' };
    };

    // =========================================================
    // QUERY BUILDERS
    // =========================================================

    window.query = function (colRef, ...constraints) {
        return {
            _client:      _client,
            _table:       colRef._table,
            _collection:  colRef._collection,
            _constraints: constraints,
            _type:        'query',
        };
    };

    window.where = function (field, op, value) {
        return { _type: 'where', field: toSnake(field), op, value };
    };

    window.orderBy = function (field, direction) {
        return { _type: 'orderBy', field: toSnake(field), direction: direction || 'asc' };
    };

    window.limit = function (n) {
        return { _type: 'limit', value: n };
    };

    // =========================================================
    // READ OPERATIONS
    // =========================================================

    window.getDoc = async function (ref) {
        const pkCol = getPKColumn(ref._table);
        const { data, error } = await _client
            .from(ref._table)
            .select('*')
            .eq(pkCol, ref._id)
            .maybeSingle();

        if (error) throw error;
        return makeDocSnap(data, ref._table, ref._id);
    };

    // Runs a collection/query ref and returns the raw { data, error } (no snapshot wrap).
    // Shared by getDocs and the realtime/polling onSnapshot path.
    function runQuery(queryOrColRef) {
        const table       = queryOrColRef._table;
        const constraints = queryOrColRef._constraints || [];

        let q = _client.from(table).select('*');

        for (const c of constraints) {
            if (c._type === 'where') {
                const { field, op, value } = c;
                if      (op === '==')              q = q.eq(field, value);
                else if (op === '!=')              q = q.neq(field, value);
                else if (op === '>')               q = q.gt(field, value);
                else if (op === '>=')              q = q.gte(field, value);
                else if (op === '<')               q = q.lt(field, value);
                else if (op === '<=')              q = q.lte(field, value);
                else if (op === 'in')              q = q.in(field, value);
                else if (op === 'not-in')          q = q.not(field, 'in', `(${value.join(',')})`);
                else if (op === 'array-contains')  q = q.contains(field, [value]);
            } else if (c._type === 'orderBy') {
                q = q.order(c.field, { ascending: c.direction !== 'desc' });
            } else if (c._type === 'limit') {
                q = q.limit(c.value);
            }
        }

        return q; // thenable: resolves to { data, error }
    }

    window.getDocs = async function (queryOrColRef) {
        const { data, error } = await runQuery(queryOrColRef);
        if (error) throw error;
        return makeQuerySnap(data || [], queryOrColRef._table);
    };

    // =========================================================
    // WRITE OPERATIONS
    // =========================================================

    window.setDoc = async function (ref, data, options) {
        const pkCol = getPKColumn(ref._table);
        const row   = toRow(data);

        // Ensure PK column is set correctly
        if (pkCol === 'id') {
            row.id = ref._id;
        } else {
            row[pkCol] = ref._id;
            delete row.id;
        }

        const { error } = await _client
            .from(ref._table)
            .upsert(row, { onConflict: pkCol });

        if (error) throw error;
    };

    window.addDoc = async function (colRef, data) {
        const row = toRow(data);
        if (!row.id) row.id = crypto.randomUUID();

        const { data: inserted, error } = await _client
            .from(colRef._table)
            .insert(row)
            .select()
            .single();

        if (error) throw error;
        return { id: inserted.id };
    };

    window.updateDoc = async function (ref, data) {
        const pkCol   = getPKColumn(ref._table);
        const raw     = toRow(data);

        // Separate increment fields from plain update fields
        const increments = {};
        const updates    = {};
        for (const [col, val] of Object.entries(raw)) {
            if (val && typeof val === 'object' && val._isIncrement) {
                increments[col] = val.amount;
            } else {
                updates[col] = val;
            }
        }

        // Plain field updates
        if (Object.keys(updates).length > 0) {
            const { error } = await _client
                .from(ref._table)
                .update(updates)
                .eq(pkCol, ref._id);
            if (error) throw error;
        }

        // Atomic increments via PostgreSQL RPC
        for (const [col, amount] of Object.entries(increments)) {
            const { error } = await _client.rpc('increment_field', {
                p_table:  ref._table,
                p_pk_col: pkCol,
                p_pk_val: ref._id,
                p_col:    col,
                p_amount: amount,
            });
            if (error) {
                // Fallback: read → increment → write (non-atomic but safe for low concurrency)
                const { data: row, error: readErr } = await _client
                    .from(ref._table).select(col).eq(pkCol, ref._id).single();
                if (!readErr && row) {
                    const newVal = (row[col] || 0) + amount;
                    await _client.from(ref._table).update({ [col]: newVal }).eq(pkCol, ref._id);
                }
            }
        }
    };

    window.deleteDoc = async function (ref) {
        const pkCol = getPKColumn(ref._table);
        const { error } = await _client
            .from(ref._table)
            .delete()
            .eq(pkCol, ref._id);
        if (error) throw error;
    };

    // =========================================================
    // REALTIME (replaces onSnapshot)
    // Fires callback immediately with current data, then on changes.
    // Returns an unsubscribe function (matches Firestore behaviour).
    // =========================================================

    // Polling fallback interval. Supabase Realtime (postgres_changes) delivers
    // changes instantly ONCE the tables are added to the `supabase_realtime`
    // publication (see supabase/enable-realtime.sql). Until/unless that is enabled,
    // this interval guarantees the UI still syncs automatically — no manual refresh.
    const REALTIME_POLL_MS = 10000;

    window.onSnapshot = function (ref, callback, errorCallback) {
        const table  = ref._table;
        const pkCol  = getPKColumn(table);
        const isDoc  = ref._type === 'doc';
        const chanId = `${table}_${Math.random().toString(36).slice(2)}`;

        let lastSig = null;   // signature of last delivered data
        let stopped = false;

        async function fetchAndCallback(force) {
            if (stopped) return;
            try {
                if (isDoc) {
                    const { data, error } = await _client
                        .from(table).select('*').eq(pkCol, ref._id).maybeSingle();
                    if (error) throw error;
                    const sig = JSON.stringify(data || null);
                    if (!force && sig === lastSig) return; // unchanged → skip re-render
                    lastSig = sig;
                    callback(makeDocSnap(data, table, ref._id));
                } else {
                    const { data, error } = await runQuery(ref);
                    if (error) throw error;
                    const rows = data || [];
                    // Order-independent signature: PostgREST doesn't guarantee row order
                    // without ORDER BY, so sort by PK before hashing to avoid phantom
                    // "changes" that would re-render (and disrupt) every poll.
                    const sorted = [...rows].sort((a, b) =>
                        String(a[pkCol] ?? a.id ?? '').localeCompare(String(b[pkCol] ?? b.id ?? '')));
                    const sig = JSON.stringify(sorted);
                    if (!force && sig === lastSig) return; // unchanged → skip re-render
                    lastSig = sig;
                    callback(makeQuerySnap(rows, table));
                }
            } catch (err) {
                if (errorCallback) errorCallback(err);
                else console.error('[onSnapshot] fetch error:', err);
            }
        }

        // Immediate fetch (Firestore behaviour) — always deliver the first result.
        fetchAndCallback(true);

        // 1) Realtime push (instant) when the publication is enabled.
        const channel = _client.channel(chanId)
            .on('postgres_changes', { event: '*', schema: 'public', table }, () => fetchAndCallback(false))
            .subscribe(status => {
                if (status === 'CHANNEL_ERROR' && errorCallback) {
                    errorCallback(new Error('Realtime channel error'));
                }
            });

        // 2) Polling fallback (change-detected, so no flicker / no disruption when idle).
        const pollTimer = setInterval(() => fetchAndCallback(false), REALTIME_POLL_MS);

        return () => {
            stopped = true;
            clearInterval(pollTimer);
            _client.removeChannel(channel);
        };
    };

    // =========================================================
    // BATCH WRITES  (sequential — Supabase has no client batch API)
    // =========================================================

    class WriteBatch {
        constructor() { this._ops = []; }

        set(ref, data, options) {
            this._ops.push({ type: 'set', ref, data, options });
            return this;
        }
        update(ref, data) {
            this._ops.push({ type: 'update', ref, data });
            return this;
        }
        delete(ref) {
            this._ops.push({ type: 'delete', ref });
            return this;
        }
        async commit() {
            for (const op of this._ops) {
                if      (op.type === 'set')    await window.setDoc(op.ref, op.data, op.options);
                else if (op.type === 'update') await window.updateDoc(op.ref, op.data);
                else if (op.type === 'delete') await window.deleteDoc(op.ref);
            }
        }
    }

    window.writeBatch = function (dbOrClient) { return new WriteBatch(); };

    // =========================================================
    // FIELD VALUE SENTINELS
    // =========================================================

    window.serverTimestamp = function () { return _TIMESTAMP_SENTINEL; };

    window.deleteField = function () { return _DELETE_SENTINEL; };

    window.increment = function (amount) {
        return { _isIncrement: true, amount: amount === undefined ? 1 : amount };
    };

    // =========================================================
    // AUTH SHIM  (maps Firebase Auth calls → Supabase Auth)
    // =========================================================

    // Auth shim with currentUser tracking (Firebase compat)
    window.auth = Object.create(_client.auth);
    window.auth.currentUser = null;

    // Maps a Supabase session to a Firebase-user-like object
    function _mapSession(session) {
        if (!session) return null;
        const u = session.user;
        return {
            uid:         u.id,
            email:       u.email,
            isAnonymous: false,
            displayName: u.user_metadata?.display_name || null,
        };
    }

    // Keep currentUser in sync with Supabase session
    _client.auth.getSession().then(({ data: { session } }) => {
        window.auth.currentUser = _mapSession(session);
    });
    _client.auth.onAuthStateChange((_event, session) => {
        window.auth.currentUser = _mapSession(session);
    });

    // onAuthStateChanged(auth, callback) → subscribe + immediate call
    window.onAuthStateChanged = function (authObj, callback) {
        // Fire immediately with current session
        _client.auth.getSession().then(({ data: { session } }) => {
            callback(_mapSession(session));
        });

        // Subscribe to future changes
        const { data: { subscription } } = _client.auth.onAuthStateChange((_event, session) => {
            callback(_mapSession(session));
        });

        return () => subscription.unsubscribe();
    };

    // signInWithEmailAndPassword(auth, email, password)
    window.signInWithEmailAndPassword = async function (authObj, email, password) {
        const { data, error } = await _client.auth.signInWithPassword({ email, password });
        if (error) throw Object.assign(new Error(error.message), { code: error.status });
        return { user: _mapSession({ user: data.user }) };
    };

    // signOut(auth)
    window.signOut = async function (authObj) {
        const { error } = await _client.auth.signOut();
        if (error) throw error;
    };

    // signInAnonymously — Supabase anon access is via the anon key without sign-in.
    // We return a mock object so the call-site doesn't throw.
    window.signInAnonymously = async function (authObj) {
        return { user: { uid: null, isAnonymous: true } };
    };

    // =========================================================
    // db SHIM  — window.db points to the Supabase client so any
    // call-site that passes window.db as first arg to doc/collection
    // still works (the shim ignores that argument).
    // =========================================================
    window.db = _client;

    console.log('[supabase.js] Client initialised. Firebase shim ready.');
})();
