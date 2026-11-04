import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import { mongodbAdapter } from "@better-auth/mongo-adapter";

export const createAuth = (db) =>
  betterAuth({
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      },
    },

    database: mongodbAdapter(db),

    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL,
    trustedOrigins: [process.env.CLIENT_URL],

    emailAndPassword: {
      enabled: true,
      minPasswordLength: 6,
      autoSignIn: false,
    },

    session: {
      expiresIn: 60 * 60 * 24 * 7,
    },

    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ["google"],
      },
    },

    advanced: {
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "none",
        secure: true,
      },
    },

    plugins: [
      jwt({
        jwt: {
          definePayload: ({ user }) => ({
            id: user.id,
          }),
          expirationTime: "60s",
        },
      }),
    ],
  });
