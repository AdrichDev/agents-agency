# aa-landing-next — sandboxed toolchain for the `next` landing build (S8).
#
# The back process never runs `next build` itself: it writes the deterministic scaffold
# (`src/lib/landing/build-next.ts`) into a temp directory, mounts it at /work and runs this
# image with `--network none`, no back env, a non-root user, a read-only rootfs and resource
# limits (`src/lib/landing/next-builder.ts`).
#
# Everything the build needs is installed here, at image build time, into /opt/deps/node_modules:
# the runner links that directory into the mounted project, so a build cannot fetch a package
# and cannot write to its dependencies. Rebuild after changing the pins:
#
#   npm run landing:next-image
#
# The next/react pins are kept in sync with `NEXT_TOOLCHAIN` in build-next.ts by
# `tests/landing-build-next.test.ts`. `overrides` in package.json bumps the two transitive pins
# `npm audit --omit=dev` flags — next declares postcss 8.4.31 exactly (GHSA-qx2v-qp2m-jg93 and
# friends, patched in 8.5.23+) and lists sharp as an optional dependency (libvips/libheif/librsvg
# CVEs, patched in 0.35.5). postcss 8.5.x is API compatible with next's CSS pipeline and sharp
# 0.35.5 sits inside next's own optional range (^0.34.3 || ^0.35.5), so neither drifts the pin;
# the test asserts the lockfile resolves exactly those two versions.
#
# Base image: node:22.23.1-slim (22-bookworm-slim), pinned by the multi-arch index digest so a
# re-pushed tag cannot change what this image is built from.
FROM node:22.23.1-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3

WORKDIR /opt/deps
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund && rm -rf /root/.npm

WORKDIR /work

# The official image ships an unprivileged `node` user (uid/gid 1000); the runner also passes
# `--user 1000:1000`. No CMD: the runner always provides the build command.
USER node
