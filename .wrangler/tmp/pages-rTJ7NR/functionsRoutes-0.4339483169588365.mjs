import { onRequest as __api_auth_epic_callback_js_onRequest } from "C:\\Users\\bruck\\Documents\\DomainData\\functions\\api\\auth\\epic\\callback.js"
import { onRequest as __api_auth_epic_epic_login_js_onRequest } from "C:\\Users\\bruck\\Documents\\DomainData\\functions\\api\\auth\\epic\\epic_login.js"
import { onRequest as __api_auth_rocketleague_profile_js_onRequest } from "C:\\Users\\bruck\\Documents\\DomainData\\functions\\api\\auth\\rocketleague\\profile.js"
import { onRequest as __api_auth_rocketleague_session_js_onRequest } from "C:\\Users\\bruck\\Documents\\DomainData\\functions\\api\\auth\\rocketleague\\session.js"
import { onRequest as __api_ocr_localize_js_onRequest } from "C:\\Users\\bruck\\Documents\\DomainData\\functions\\api\\ocr\\localize.js"
import { onRequest as __api_ocr_localTracking_js_onRequest } from "C:\\Users\\bruck\\Documents\\DomainData\\functions\\api\\ocr\\localTracking.js"
import { onRequest as __api_ocr_index_js_onRequest } from "C:\\Users\\bruck\\Documents\\DomainData\\functions\\api\\ocr\\index.js"

export const routes = [
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