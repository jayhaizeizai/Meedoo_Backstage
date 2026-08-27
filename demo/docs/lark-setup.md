# Lark app setup for MeeDoo

## 1. Create the app

Create a custom/internal app in the Lark Developer Console. Use `MeeDoo` as the
app name and enable the **Web App** capability.

Set the web app desktop and mobile URL to:

```text
https://backstagetest.meedoo.fun/upload
```

## 2. Configure OAuth

In **Security Settings**, add this exact redirect URL (including HTTPS and with
no trailing slash):

```text
https://backstagetest.meedoo.fun/api/auth/lark/callback
```

For the first login test, no additional item needs to be added in **Permissions
& Scopes**. MeeDoo requests Lark's built-in OAuth identity scope:

```text
auth:user.id:read
```

This scope may not appear in the normal permission search list. It is requested
by the authorization URL and provides the app-scoped identity returned by the
authentication `user_info` endpoint. Add contact API permissions later only if
MeeDoo needs department, employee number, phone, or broader directory lookup.

## 3. Release the app

Create a version, select the team members or departments that may use MeeDoo,
submit it for tenant administrator review, and install/release it to the Lark
workspace. Event subscriptions and a bot are not required for the login phase.

## 4. Configure the server

Copy the App ID and App Secret from **Credentials & Basic Info** into
`/etc/meedoo/meedoo.env` on the server:

```text
LARK_APP_ID=cli_xxx
LARK_APP_SECRET=xxx
```

Do not place the App Secret in GitHub, screenshots, browser code, or chat logs.
Restart `meedoo.service` after changing the file.

Keep `LARK_AUTH_REQUIRED=false` for the first test. After one complete login
works, change it to `true` so `/upload` and `/dashboard` require a valid session.

## 5. Test

1. Open `https://backstagetest.meedoo.fun/login`.
2. Select **Continue with Lark**.
3. Approve the requested profile access.
4. Confirm that MeeDoo returns to `/upload` and shows the real user name/avatar.
5. Sign out and repeat once in the Lark desktop client.
