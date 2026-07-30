/** @type {import('next').NextConfig} */

/**
 * The commit this bundle was built from, baked in at build time.
 *
 * /security tells sceptical admins to read the published source before granting
 * OAuth access, and the fair objection to that is "the code you published isn't
 * necessarily the code you deployed". Publishing the hash the running build came
 * from makes that checkable: look it up in the public repo, and if it isn't
 * there, the claim is false.
 *
 * COMMIT_REF is set by Netlify during the build. Empty locally, which the UI
 * reports honestly rather than inventing a value.
 */
const COMMIT = process.env.COMMIT_REF ?? "";

const nextConfig = {
  reactStrictMode: true,
  env: {
    // NEXT_PUBLIC_ so it is inlined into the client bundle as a literal — being
    // inspectable by the reader is the entire point.
    NEXT_PUBLIC_COMMIT_REF: COMMIT,
  },
};

export default nextConfig;
