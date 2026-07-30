# EVE in a reproducible container.
#
# Two stages: compile with a plain Node image, then run on Playwright's image,
# which already carries Chromium and the system libraries a headless browser
# needs. That is the whole reason this file exists — "it works on my machine"
# is a bad answer for a tool whose output is meant to be comparable across
# builds and across a team.
#
#   docker build -t eve .
#   docker run --rm eve run mock: --persona first-time-user
#   docker run --rm -v "$PWD/out:/work/.eve-output" eve run https://example.com
#
# The MCP server speaks stdio, so it works over `docker run -i`:
#   docker run --rm -i --entrypoint eve-mcp eve

# ---- build -----------------------------------------------------------------
FROM node:20-bookworm-slim AS build

WORKDIR /app

# Install against the lockfile before copying sources, so dependency layers
# survive source edits. PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD keeps the optional
# peer from fetching a browser here; the runtime stage already has one.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# Reinstall without dev dependencies so only runtime code ships.
RUN npm ci --omit=dev

# ---- runtime ---------------------------------------------------------------
# Pinned to the Playwright release matching this project's peer dependency
# floor; the bundled browser must match the driver that runs it.
FROM mcr.microsoft.com/playwright:v1.62.0-noble AS runtime

# Reports are written relative to the working directory. Mount a volume here
# to get them out.
WORKDIR /work

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY --from=build /app/node_modules /opt/eve/node_modules
COPY --from=build /app/dist /opt/eve/dist
COPY --from=build /app/package.json /opt/eve/package.json
COPY bin /opt/eve/bin

# Expose both CLIs on PATH so `--entrypoint eve-mcp` works too.
RUN ln -s /opt/eve/bin/eve.js /usr/local/bin/eve \
 && ln -s /opt/eve/bin/eve-mcp.js /usr/local/bin/eve-mcp \
 && chmod +x /opt/eve/bin/eve.js /opt/eve/bin/eve-mcp.js

# The Playwright image ships a non-root `pwuser`; run as it rather than root.
RUN chown -R pwuser:pwuser /work
USER pwuser

ENTRYPOINT ["eve"]
CMD ["--help"]
