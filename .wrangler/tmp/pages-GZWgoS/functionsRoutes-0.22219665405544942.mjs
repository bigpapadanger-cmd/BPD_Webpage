import { onRequestGet as __api_auth_epic_epic_logout_js_onRequestGet } from "C:\\Users\\bruck\\Documents\\DomainData\\functions\\api\\auth\\epic\\epic_logout.js"
import { onRequestPost as __api_auth_epic_epic_logout_js_onRequestPost } from "C:\\Users\\bruck\\Documents\\DomainData\\functions\\api\\auth\\epic\\epic_logout.js"
import { onRequest as __api_auth_epic_callback_js_onRequest } from "C:\\Users\\bruck\\Documents\\DomainData\\functions\\api\\auth\\epic\\callback.js"
import { onRequest as __api_auth_epic_epic_login_js_onRequest } from "C:\\Users\\bruck\\Documents\\DomainData\\functions\\api\\auth\\epic\\epic_login.js"
import { onRequest as __api_auth_rocketleague_profile_js_onRequest } from "C:\\Users\\bruck\\Documents\\DomainData\\functions\\api\\auth\\rocketleague\\profile.js"
import { onRequest as __api_auth_rocketleague_session_js_onRequest } from "C:\\Users\\bruck\\Documents\\DomainData\\functions\\api\\auth\\rocketleague\\session.js"
import { onRequestGet as __api_curseforge_mods_js_onRequestGet } from "C:\\Users\\bruck\\Documents\\DomainData\\functions\\api\\curseforge\\mods.js"
import { onRequest as __api_ocr_localize_js_onRequest } from "C:\\Users\\bruck\\Documents\\DomainData\\functions\\api\\ocr\\localize.js"
import { onRequest as __api_ocr_localTracking_js_onRequest } from "C:\\Users\\bruck\\Documents\\DomainData\\functions\\api\\ocr\\localTracking.js"
import { onRequest as __api_ocr_index_js_onRequest } from "C:\\Users\\bruck\\Documents\\DomainData\\functions\\api\\ocr\\index.js"

export const routes = [
    {
      routePath: "/api/auth/epic/epic_logout",
      mountPath: "/api/auth/epic",
      method: "GET",
      middlewares: [],
      modules: [__api_auth_epic_epic_logout_js_onRequestGet],
    },
  {
      routePath: "/api/auth/epic/epic_logout",
      mountPath: "/api/auth/epic",
      method: "POST",
      middlewares: [],
      modules: [__api_auth_epic_epic_logout_js_onRequestPost],
    },
  {
      routePath: "/api/auth/epic/callback",
      mountPath: "/api/auth/epic",
      method: "",
      middlewares: [],
      modules: [__api_auth_epic_callback_js_onRequest],
    },
  {
      routePath: "/api/auth/epic/epic_login",
      mountPath: "/api/auth/epic",
      method: "",
      middlewares: [],
      modules: [__api_auth_epic_epic_login_js_onRequest],
    },
  {
      routePath: "/api/auth/rocketleague/profile",
      mountPath: "/api/auth/rocketleague",
      method: "",
      middlewares: [],
      modules: [__api_auth_rocketleague_profile_js_onRequest],
    },
  {
      routePath: "/api/auth/rocketleague/session",
      mountPath: "/api/auth/rocketleague",
      method: "",
      middlewares: [],
      modules: [__api_auth_rocketleague_session_js_onRequest],
    },
  {
      routePath: "/api/curseforge/mods",
      mountPath: "/api/curseforge",
      method: "GET",
      middlewares: [],
      modules: [__api_curseforge_mods_js_onRequestGet],
    },
  {
      routePath: "/api/ocr/localize",
      mountPath: "/api/ocr",
      method: "",
      middlewares: [],
      modules: [__api_ocr_localize_js_onRequest],
    },
  {
      routePath: "/api/ocr/localTracking",
      mountPath: "/api/ocr",
      method: "",
      middlewares: [],
      modules: [__api_ocr_localTracking_js_onRequest],
    },
  {
      routePath: "/api/ocr",
      mountPath: "/api/ocr",
      method: "",
      middlewares: [],
      modules: [__api_ocr_index_js_onRequest],
    },
  ]