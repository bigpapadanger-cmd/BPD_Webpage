"use strict";

// Private server-side display-name policy. Keep this data out of browser bundles;
// comparisons are deliberately conservative and Supabase remains authoritative.
export const BLOCKED_DISPLAY_NAME_TERMS = Object.freeze([
    "fuck", "shit", "bitch", "bastard", "asshole", "motherfucker", "bullshit",
    "dickhead", "douchebag", "jackass", "porn", "blowjob", "handjob", "pornstar",
    "rape", "rapist", "retard", "tranny", "faggot", "nigger", "kike", "chink",
    "spic", "wetback", "killyourself", "killallpeople"
]);

export const RESERVED_DISPLAY_NAME_FORMS = Object.freeze([
    "bpdadmin", "bpdsupport", "bpdmoderator", "bpdstaff", "bpdofficial", "bpdowner",
    "adminbpd", "supportbpd", "systemadmin", "systemmoderator", "systemsupport"
]);
