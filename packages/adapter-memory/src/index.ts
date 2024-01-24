/**
 * <div style={{display: "flex", justifyContent: "space-between", alignItems: "center", padding: 16}}>
 *  Official Memory adapter for Auth.js / NextAuth.js.
 *  <img style={{display: "block"}} width="38" src="https://www.svgrepo.com/show/276812/ram-memory-ram.svg"/>
 * </div>
 * 
 * In-memory adapter for Auth.js / NextAuth.js. This adapter is **not** recommended for production use, but is useful for testing and development.
 * 
 * All data is stored in memory and is lost when the server reloads.
 *
 * ## Installation
 *
 * ```bash npm2yarn
 * npm install @auth/memory-adapter
 * ```
 *
 * @module @auth/memory-adapter
 */
import {
  Adapter,
  AdapterAccount,
  AdapterSession,
  AdapterUser,
  VerificationToken,
  AdapterAuthenticator,
} from "@auth/core/adapters"
import type { readFileSync, writeFileSync } from "fs"

/**
 * Represents a store of a specific type.
 */
export type MemoryStore<T> = {
  get(key: string): T | undefined
  set(key: string, value: T): void
  delete(key: string): void
  values(): IterableIterator<T>
  forEach(callback: (value: T, key: string) => void): void
}

/**
 * Represents the in-memory data structure for the adapter.
 */
export type Memory = {
  users: MemoryStore<AdapterUser>
  accounts: MemoryStore<AdapterAccount>
  sessions: MemoryStore<AdapterSession>
  verificationTokens: MemoryStore<VerificationToken>
  authenticators: MemoryStore<AdapterAuthenticator>
}

const mapStore: <T>() => MemoryStore<T> = <T>() => new Map<string, T>()

type SubFS = { readFileSync: typeof readFileSync, writeFileSync: typeof writeFileSync }
export const jsonFileStore = <T>(fs: SubFS, filePath: string): MemoryStore<T> => {
  function load(): Map<string, T> {
    // Create file if it doesn't exist
    let data: Record<string, T> = {}
    try {
      data = JSON.parse(fs.readFileSync(filePath, "utf8"))
    } catch (e) {
      fs.writeFileSync(filePath, "{}")
    }
    // Load Uint8Arrays
    Object.values(data).forEach((instance) => {
      if (instance instanceof Object) {
        Object.entries(instance).forEach(([key, value]) => {
          if (value && typeof value === "object" && "type" in value && value.type === "uint8array" && typeof value.data === "string") {
            Object.assign(instance, { [key]: new Uint8Array(Buffer.from(value.data, "base64")) })
          }
        })
      }
    })

    return new Map(Object.entries(data))
  }
  function dump(data: Map<string, T>) {
    // Dump Uint8Arrays
    data.forEach((instance) => {
      if (instance instanceof Object) {
        Object.entries(instance).forEach(([key, value]) => {
          if (value && value instanceof Uint8Array) {
            Object.assign(instance, { [key]: { type: "uint8array", data: Buffer.from(value).toString("base64") } })
          }
        })
      }
    })
    fs.writeFileSync(filePath, JSON.stringify(data))
  }

  // Load initial data
  let store = load()

  return {
    get(key: string) {
      return store.get(key)
    },
    set(key: string, value: T) {
      store.set(key, value)
      dump(store)
    },
    delete(key: string) {
      store.delete(key)
      dump(store)
    },
    values() {
      return store.values()
    },
    forEach(callback: (value: T, key: string) => void) {
      return store.forEach(callback)
    }
  }
}

export function initJSONMemory(fs: SubFS, baseDir: string): Memory {
  return {
    users: jsonFileStore(fs, `${baseDir}/users.json`),
    accounts: jsonFileStore(fs, `${baseDir}/accounts.json`),
    sessions: jsonFileStore(fs, `${baseDir}/sessions.json`),
    verificationTokens: jsonFileStore(fs, `${baseDir}/verificationTokens.json`),
    authenticators: jsonFileStore(fs, `${baseDir}/authenticators.json`),
  }
}

/**
 * Initializes a new instance of the Memory object.
 * @returns A Memory object with empty maps for users, accounts, sessions, etc.
 */
export function initMemory(): Memory {
  return {
    users: mapStore<AdapterUser>(),
    accounts: mapStore<AdapterAccount>(),
    sessions: mapStore<AdapterSession>(),
    verificationTokens: mapStore<VerificationToken>(),
    authenticators: mapStore<AdapterAuthenticator>(),
  }
}

/**
 * ## Setup
 *
 * Add this adapter to your `pages/api/auth/[...nextauth].js` next-auth configuration object:
 *
 * ```js title="pages/api/auth/[...nextauth].js"
 * import NextAuth from "next-auth"
 * import GoogleProvider from "next-auth/providers/google"
 * import { MemoryAdapter } from "@auth/memory-adapter"
 *
 *
 * export default NextAuth({
 *   adapter: MemoryAdapter(),
 *   providers: [
 *     GoogleProvider({
 *       clientId: process.env.GOOGLE_CLIENT_ID,
 *       clientSecret: process.env.GOOGLE_CLIENT_SECRET,
 *     }),
 *   ],
 * })
 * ```
 * 
 * ### Providing initial data
 * 
 * You can optionally provide initial data to the adapter by passing a `Memory` object to the `MemoryAdapter` function.
 * This allows you to pre-populate the database with data that is restored when the server reloads. Any changes made to
 * the database will be lost when the server reloads.
 * 
 * ```js title="pages/api/auth/[...nextauth].js"
 * import NextAuth from "next-auth"
 * import { MemoryAdapter, initMemory } from "@auth/memory-adapter"
 * 
 * // Initialize an empty Memory object
 * const memory = initMemory()
 * // Add some data to it
 * memory.users.set("123", {
 *   id: "123",
 *   name: "John Doe",
 *   email: "user@example.com",
 *   emailVerified: null,
 * })
 * 
 * export default NextAuth({
 *   adapter: MemoryAdapter(memory),
 *   // ...
 * })
 * ```
 **/
export function MemoryAdapter(memory?: Memory): Adapter {
  const { users, accounts, sessions, verificationTokens, authenticators } =
    memory ?? initMemory()

  // Create the adapter object first and then populate it.
  // This allows us to call adapter functions from within.
  const adapter: Adapter = {}

  // Assign all functions in place
  Object.assign(adapter, {
    async createUser(user) {
      const newUser = { ...user, id: makeid(32) }
      users.set(newUser.id, newUser)

      return newUser
    },
    async getUser(id) {
      return users.get(id) ?? null
    },
    async getUserByEmail(email) {
      return (
        Array.from(users.values()).find((user) => user.email === email) ?? null
      )
    },
    async getUserByAccount(providerAccountId) {
      const account = accounts.get(providerAccountId.providerAccountId)
      if (!account) return null

      return users.get(account.userId) ?? null
    },
    async updateUser(user: Partial<AdapterUser> & Pick<AdapterUser, "id">) {
      const currentUser = users.get(user.id)
      if (!currentUser) throw new Error("User not found")

      const updatedUser = { ...currentUser, ...user }
      users.set(user.id, updatedUser)

      return updatedUser
    },
    async deleteUser(id) {
      const user = users.get(id)
      if (!user) return

      // Delete sessions
      if (!adapter.deleteSession)
        throw new Error("Adapter does not implement deleteSession!")
      const { deleteSession } = adapter
      sessions.forEach(async (session) => {
        if (session.userId === user.id) {
          await deleteSession(session.sessionToken)
        }
      })

      // Delete accounts
      if (!adapter.unlinkAccount)
        throw new Error("Adapter does not implement unlinkAccount!")
      const { unlinkAccount } = adapter
      accounts.forEach(async (account) => {
        if (account.userId === user.id) {
          await unlinkAccount(account)
        }
      })

      // Delete verification tokens
      if (!adapter.useVerificationToken)
        throw new Error("Adapter does not implement useVerificationToken!")
      const { useVerificationToken } = adapter
      verificationTokens.forEach(async (verificationToken) => {
        if (verificationToken.identifier === user.email) {
          await useVerificationToken(verificationToken)
        }
      })

      // Delete user
      users.delete(id)

      return
    },
    async linkAccount(account) {
      accounts.set(account.providerAccountId, account)

      return account
    },
    async unlinkAccount(account) {
      // Find account
      const currentAccount = accounts.get(account.providerAccountId)
      if (!currentAccount) return

      // Delete account
      accounts.delete(currentAccount.providerAccountId)

      return
    },
    // async listLinkedAccounts(userId: string) {
    //   return Array.from(accounts.values()).filter(
    //     (account) => account.userId === userId
    //   )
    // },
    async createSession(session) {
      sessions.set(session.sessionToken, session)

      return session
    },
    async getSessionAndUser(sessionToken) {
      const session = sessions.get(sessionToken)
      if (!session) return null

      // Remove if expired
      if (session.expires < new Date()) {
        if (!adapter.deleteSession)
          throw new Error("Adapter does not implement deleteSession!")
        await adapter.deleteSession(sessionToken)

        return null
      }

      const user = users.get(session.userId)
      if (!user) return null

      return { session, user }
    },
    async updateSession(session) {
      const currentSession = sessions.get(session.sessionToken)
      if (!currentSession) throw new Error("Session not found")

      const updatedSession = { ...currentSession, ...session }
      sessions.set(session.sessionToken, updatedSession)

      return updatedSession
    },
    async deleteSession(sessionToken: string) {
      sessions.delete(sessionToken)

      return
    },
    async createVerificationToken(verificationToken) {
      verificationTokens.set(verificationToken.token, verificationToken)

      return verificationToken
    },
    async useVerificationToken(params: {
      identifier: string
      token: string
    }) {
      const { token } = params

      // Find verification token
      const verificationToken = verificationTokens.get(token)
      if (!verificationToken) return null

      // Delete used verification token
      verificationTokens.delete(token)

      return verificationToken
    },
    async listAuthenticatorsByUserId(userId) {
      const userAccounts = Array.from(accounts.values()).filter(
        (account) => account.userId === userId
      )
      const userAuthenticators = Array.from(authenticators.values()).filter(
        (authenticator) =>
          userAccounts.find(
            (account) =>
              account.providerAccountId === authenticator.providerAccountId
          )
      )

      return userAuthenticators
    },
    async createAuthenticator(authenticator) {
      authenticators.set(asBase64(authenticator.credentialID), authenticator)

      console.log("Available authenticators", Array.from(authenticators.values()).map(a => asBase64(a.credentialID)))

      return authenticator
    },
    async getAccount(providerAccountId) {
      return accounts.get(providerAccountId) ?? null
    },
    async updateAuthenticatorCounter(authenticator, newCounter) {
      const auth = await this.getAuthenticator(authenticator.credentialID)
      if (!auth) throw new Error("Authenticator not found")

      const updatedAuthenticator = {
        ...auth,
        counter: newCounter,
      }
      authenticators.set(asBase64(authenticator.credentialID), auth)

      return updatedAuthenticator
    },
    getAuthenticator(authenticatorID) {
      console.log("Looking for authenticator", asBase64(authenticatorID))
      console.log("Available authenticators", Array.from(authenticators.values()).map(a => asBase64(a.credentialID)))
      return authenticators.get(asBase64(authenticatorID)) ?? null
    }
  } satisfies Required<Adapter>)

  return adapter
}

/**
 * Generates a random string of the specified length.
 * @param length The length of the generated string.
 * @returns The randomly generated string.
 */
function makeid(length: number) {
  let result = ""
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"

  // Build a string of the specified length by randomly selecting
  // characters from the alphabet at each iteration.
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * alphabet.length)
    result += alphabet.charAt(randomIndex)
  }

  return result
}

export function asBase64(buffer: Uint8Array): string {
  return Buffer.from(buffer).toString("base64")
}