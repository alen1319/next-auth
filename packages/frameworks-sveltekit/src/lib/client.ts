import type {
  BuiltInProviderType,
  RedirectableProviderType,
} from "@auth/core/providers"
import { base } from "$app/paths"
import type { WebAuthnOptionsResponseBody } from "@auth/core/lib/utils/webauthn-utils"

type LiteralUnion<T extends U, U = string> = T | (U & Record<never, never>)

interface SignInOptions extends Record<string, unknown> {
  /**
   * Specify to which URL the user will be redirected after signing in. Defaults to the page URL the sign-in is initiated from.
   *
   * [Documentation](https://next-auth.js.org/getting-started/client#specifying-a-callbackurl)
   */
  callbackUrl?: string
  /** [Documentation](https://next-auth.js.org/getting-started/client#using-the-redirect-false-option) */
  redirect?: boolean
}

interface SignOutParams<R extends boolean = true> {
  /** [Documentation](https://next-auth.js.org/getting-started/client#specifying-a-callbackurl-1) */
  callbackUrl?: string
  /** [Documentation](https://next-auth.js.org/getting-started/client#using-the-redirect-false-option-1 */
  redirect?: R
}

/** Match `inputType` of `new URLSearchParams(inputType)` */
export type SignInAuthorizationParams =
  | string
  | string[][]
  | Record<string, string>
  | URLSearchParams

/**
 * Fetch webauthn options from server and prompt user for authentication or registration.
 * Returns either the completed WebAuthn response or an error request.
 *
 * @param providerId provider ID
 * @param options SignInOptions
 * @returns WebAuthn response or error
 */
async function webAuthnOptions(providerId: string, options?: SignInOptions) {
  const { startAuthentication, startRegistration } = await import(
    "@simplewebauthn/browser"
  )
  const baseUrl = `${base}/auth/`

  // @ts-expect-error
  const params = new URLSearchParams(options)

  const optionsResp = await fetch(
    `${baseUrl}/webauthn-options/${providerId}?${params}`
  )
  if (!optionsResp.ok) {
    return { error: optionsResp }
  }
  const optionsData: WebAuthnOptionsResponseBody = await optionsResp.json()

  if (optionsData.action === "authenticate") {
    const webAuthnResponse = await startAuthentication(optionsData.options)
    return { data: webAuthnResponse, action: "authenticate" }
  } else {
    const webAuthnResponse = await startRegistration(optionsData.options)
    return { data: webAuthnResponse, action: "register" }
  }
}

/**
 * Client-side method to initiate a signin flow
 * or send the user to the signin page listing all possible providers.
 * Automatically adds the CSRF token to the request.
 *
 * [Documentation](https://authjs.dev/reference/sveltekit/client#signin)
 */
export async function signIn<
  P extends RedirectableProviderType | undefined = undefined,
>(
  providerId?: LiteralUnion<
    P extends RedirectableProviderType
      ? P | BuiltInProviderType
      : BuiltInProviderType
  >,
  options?: SignInOptions,
  authorizationParams?: SignInAuthorizationParams
) {
  const { callbackUrl = window.location.href, redirect = true } = options ?? {}

  // TODO: Support custom providers
  const isCredentials = providerId === "credentials"
  const isEmail = providerId === "email"
  const isWebAuthn = providerId === "webauthn"
  const isSupportingReturn = isCredentials || isEmail || isWebAuthn

  const basePath = base ?? ""
  const signInUrl = `${basePath}/auth/${
    isCredentials || isWebAuthn ? "callback" : "signin"
  }/${providerId}`

  const _signInUrl = `${signInUrl}?${new URLSearchParams(authorizationParams)}`

  // Execute WebAuthn client flow if needed
  const webAuthnBody: Record<string, unknown> = {}
  if (isWebAuthn) {
    const { data, error, action } = await webAuthnOptions(providerId, options)
    if (error) {
      // logger.error(new Error(await error.text()))
      return
    }
    webAuthnBody.data = JSON.stringify(data)
    webAuthnBody.action = action
  }

  // TODO: Remove this since Sveltekit offers the CSRF protection via origin check
  const csrfTokenResponse = await fetch(`${basePath}/auth/csrf`)
  const { csrfToken } = await csrfTokenResponse.json()

  const res = await fetch(_signInUrl, {
    method: "post",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Auth-Return-Redirect": "1",
    },
    // @ts-ignore
    body: new URLSearchParams({
      ...options,
      csrfToken,
      callbackUrl,
      ...webAuthnBody,
    }),
  })

  const data = await res.clone().json()

  if (redirect || !isSupportingReturn) {
    // TODO: Do not redirect for Credentials and Email providers by default in next major
    window.location.href = data.url ?? callbackUrl
    // If url contains a hash, the browser does not reload the page. We reload manually
    if (data.url.includes("#")) window.location.reload()
    return
  }

  return res
}

/**
 * Signs the user out, by removing the session cookie.
 * Automatically adds the CSRF token to the request.
 *
 * [Documentation](https://authjs.dev/reference/sveltekit/client#signout)
 */
export async function signOut(options?: SignOutParams) {
  const { callbackUrl = window.location.href } = options ?? {}
  const basePath = base ?? ""
  // TODO: Remove this since Sveltekit offers the CSRF protection via origin check
  const csrfTokenResponse = await fetch(`${basePath}/auth/csrf`)
  const { csrfToken } = await csrfTokenResponse.json()
  const res = await fetch(`${basePath}/auth/signout`, {
    method: "post",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Auth-Return-Redirect": "1",
    },
    body: new URLSearchParams({
      csrfToken,
      callbackUrl,
    }),
  })
  const data = await res.json()

  const url = data.url ?? callbackUrl
  window.location.href = url
  // If url contains a hash, the browser does not reload the page. We reload manually
  if (url.includes("#")) window.location.reload()
}
