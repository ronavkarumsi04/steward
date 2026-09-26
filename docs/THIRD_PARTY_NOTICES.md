# Third-Party Notices

Generated 2026-09-26 from the dependency graph installed in this repository.
**508 third-party packages** are present in the installed closure. Direct dependencies: 34 across 4 applications.

Steward itself is licensed under the Apache License 2.0 (see LICENSE). The components below are
provided under their own licenses; their copyright notices and license texts remain in effect and must be
preserved when redistributing this software. Where a component is used as a build-time or development
dependency only, it does not ship in the runtime image.

Regenerate with:

```bash
node scripts/generate-third-party-notices.mjs
```

## License summary

| License | Packages |
| --- | ---: |
| MIT | 356 |
| Apache-2.0 | 89 |
| ISC | 23 |
| BSD-3-Clause | 20 |
| BSD-2-Clause | 9 |
| MPL-2.0 | 2 |
| Unlicense | 2 |
| 0BSD | 1 |
| Apache-2.0 AND LGPL-3.0-or-later | 1 |
| Apache-2.0 AND MIT | 1 |
| CC-BY-4.0 | 1 |
| MIT-0 | 1 |
| NOT DECLARED | 1 |
| Python-2.0 | 1 |

## Packages with no declared license

These packages do not declare a license in their package.json. Review each before redistribution:

| Package | Version | Repository |
| --- | --- | --- |
| unionfs | 4.6.0 | https://github.com/streamich/unionfs |

## Direct dependencies

| Workspace | Package | Declared range |
| --- | --- | --- |
| apps/api | @hono/node-server | 2.1.1 |
| apps/api | @types/pg | ^8.23.1 |
| apps/api | dotenv | ^17.4.2 |
| apps/api | eslint | ^9.39.0 |
| apps/api | hono | 4.13.7 |
| apps/api | pg | ^8.23.0 |
| apps/api | tsx | ^4.20.6 |
| apps/api | typescript | ^5.9.3 |
| apps/api | vitest | ^3.2.4 |
| apps/api | zod | ^4.6.5 |
| apps/companion | eslint | ^9.39.0 |
| apps/companion | tsx | ^4.20.6 |
| apps/companion | typescript | ^5.9.3 |
| apps/companion | vitest | ^3.2.4 |
| apps/web | @playwright/test | 1.63.0 |
| apps/web | @tailwindcss/postcss | ^4.3.3 |
| apps/web | @types/react | ^19.3.0 |
| apps/web | @types/react-dom | ^19.3.0 |
| apps/web | next | 16.3.5 |
| apps/web | postcss | ^8.5.6 |
| apps/web | react | 19.3.0 |
| apps/web | react-dom | 19.3.0 |
| apps/web | server-only | 0.0.1 |
| apps/web | tailwindcss | ^4.3.3 |
| apps/web | typescript | ^5.9.3 |
| apps/web | vitest | ^3.2.4 |
| apps/worker | @temporalio/activity | 1.23.0 |
| apps/worker | @temporalio/client | 1.23.0 |
| apps/worker | @temporalio/worker | 1.23.0 |
| apps/worker | dotenv | ^17.4.2 |
| apps/worker | eslint | ^9.39.0 |
| apps/worker | tsx | ^4.20.6 |
| apps/worker | typescript | ^5.9.3 |
| apps/worker | vitest | ^3.2.4 |

## Installed packages

| Package | Version | License | Project |
| --- | --- | --- | --- |
| @alloc/quick-lru | 5.3.0 | MIT | https://github.com/aleclarson/quick-lru |
| @aws-sdk/client-bedrock-runtime | 3.1136.0 | Apache-2.0 | https://github.com/aws/aws-sdk-js-v3 |
| @aws-sdk/core | 3.978.0 | Apache-2.0 | https://github.com/aws/aws-sdk-js-v3 |
| @aws-sdk/credential-provider-env | 3.972.71 | Apache-2.0 | https://github.com/aws/aws-sdk-js-v3 |
| @aws-sdk/credential-provider-http | 3.972.73 | Apache-2.0 | https://github.com/aws/aws-sdk-js-v3 |
| @aws-sdk/credential-provider-ini | 3.973.16 | Apache-2.0 | https://github.com/aws/aws-sdk-js-v3 |
| @aws-sdk/credential-provider-login | 3.972.78 | Apache-2.0 | https://github.com/aws/aws-sdk-js-v3 |
| @aws-sdk/credential-provider-node | 3.972.83 | Apache-2.0 | https://github.com/aws/aws-sdk-js-v3 |
| @aws-sdk/credential-provider-process | 3.972.71 | Apache-2.0 | https://github.com/aws/aws-sdk-js-v3 |
| @aws-sdk/credential-provider-sso | 3.973.15 | Apache-2.0 | https://github.com/aws/aws-sdk-js-v3 |
| @aws-sdk/credential-provider-web-identity | 3.972.77 | Apache-2.0 | https://github.com/aws/aws-sdk-js-v3 |
| @aws-sdk/eventstream-handler-node | 3.972.34 | Apache-2.0 | https://github.com/aws/aws-sdk-js-v3 |
| @aws-sdk/middleware-eventstream | 3.972.29 | Apache-2.0 | https://github.com/aws/aws-sdk-js-v3 |
| @aws-sdk/middleware-websocket | 3.972.53 | Apache-2.0 | https://github.com/aws/aws-sdk-js-v3 |
| @aws-sdk/nested-clients | 3.997.45 | Apache-2.0 | https://github.com/aws/aws-sdk-js-v3 |
| @aws-sdk/signature-v4-multi-region | 3.996.46 | Apache-2.0 | https://github.com/aws/aws-sdk-js-v3 |
| @aws-sdk/token-providers | 3.1136.0 | Apache-2.0 | https://github.com/aws/aws-sdk-js-v3 |
| @aws-sdk/types | 3.974.5 | Apache-2.0 | https://github.com/aws/aws-sdk-js-v3 |
| @aws-sdk/xml-builder | 3.972.40 | Apache-2.0 | https://github.com/aws/aws-sdk-js-v3 |
| @aws/lambda-invoke-store | 0.3.0 | Apache-2.0 | https://github.com/awslabs/aws-lambda-invoke-store |
| @balena/dockerignore | 1.0.2 | Apache-2.0 | git@github.com:balena-io-modules/dockerignore |
| @drizzle-team/brocli | 0.10.2 | Apache-2.0 | https://github.com/drizzle-team/brocli |
| @epic-web/invariant | 1.0.0 | MIT | https://github.com/epicweb-dev/invariant |
| @esbuild-kit/core-utils | 3.3.2 | MIT | esbuild-kit/core-utils |
| @esbuild-kit/esm-loader | 2.6.5 | MIT | esbuild-kit/esm-loader |
| @esbuild/win32-x64 | 0.28.2 | MIT | https://github.com/evanw/esbuild |
| @eslint-community/eslint-utils | 4.10.1 | MIT | https://github.com/eslint-community/eslint-utils |
| @eslint-community/regexpp | 4.12.2 | MIT | https://github.com/eslint-community/regexpp |
| @eslint/config-array | 0.21.2 | Apache-2.0 | https://github.com/eslint/rewrite |
| @eslint/config-helpers | 0.4.2 | Apache-2.0 | https://github.com/eslint/rewrite |
| @eslint/core | 0.17.0 | Apache-2.0 | https://github.com/eslint/rewrite |
| @eslint/eslintrc | 3.3.7 | MIT | eslint/eslintrc |
| @eslint/js | 9.39.5 | MIT | https://github.com/eslint/eslint |
| @eslint/object-schema | 2.1.7 | Apache-2.0 | https://github.com/eslint/rewrite |
| @eslint/plugin-kit | 0.4.1 | Apache-2.0 | https://github.com/eslint/rewrite |
| @grpc/grpc-js | 1.14.5 | Apache-2.0 | https://github.com/grpc/grpc-node/tree/master/packages/grpc-js |
| @grpc/proto-loader | 0.7.15 | Apache-2.0 | https://github.com/grpc/grpc-node |
| @hono/node-server | 2.1.1 | MIT | https://github.com/honojs/node-server |
| @humanfs/core | 0.19.2 | Apache-2.0 | https://github.com/humanwhocodes/humanfs |
| @humanfs/node | 0.16.8 | Apache-2.0 | https://github.com/humanwhocodes/humanfs |
| @humanfs/types | 0.15.0 | Apache-2.0 | https://github.com/humanwhocodes/humanfs |
| @humanwhocodes/module-importer | 1.0.1 | Apache-2.0 | https://github.com/humanwhocodes/module-importer |
| @humanwhocodes/retry | 0.4.3 | Apache-2.0 | https://github.com/humanwhocodes/retry |
| @img/colour | 1.1.0 | MIT | https://github.com/lovell/colour |
| @img/sharp-win32-x64 | 0.35.4 | Apache-2.0 AND LGPL-3.0-or-later | https://github.com/lovell/sharp |
| @jridgewell/gen-mapping | 0.3.13 | MIT | https://github.com/jridgewell/sourcemaps |
| @jridgewell/remapping | 2.3.5 | MIT | https://github.com/jridgewell/sourcemaps |
| @jridgewell/resolve-uri | 3.1.2 | MIT | https://github.com/jridgewell/resolve-uri |
| @jridgewell/source-map | 0.3.11 | MIT | https://github.com/jridgewell/sourcemaps |
| @jridgewell/sourcemap-codec | 1.6.0 | MIT | https://github.com/jridgewell/sourcemaps |
| @jridgewell/trace-mapping | 0.3.31 | MIT | https://github.com/jridgewell/sourcemaps |
| @js-sdsl/ordered-map | 4.4.2 | MIT | https://github.com/js-sdsl/js-sdsl |
| @jsonjoy.com/base64 | 17.67.0 | Apache-2.0 | jsonjoy-com/base64 |
| @jsonjoy.com/buffers | 17.67.0 | Apache-2.0 | jsonjoy-com/buffers |
| @jsonjoy.com/codegen | 17.67.0 | Apache-2.0 | jsonjoy-com/codegen |
| @jsonjoy.com/fs-core | 4.78.1 | Apache-2.0 | streamich/memfs |
| @jsonjoy.com/fs-fsa | 4.78.1 | Apache-2.0 | streamich/memfs |
| @jsonjoy.com/fs-node | 4.78.1 | Apache-2.0 | streamich/memfs |
| @jsonjoy.com/fs-node-builtins | 4.78.1 | Apache-2.0 | streamich/memfs |
| @jsonjoy.com/fs-node-to-fsa | 4.78.1 | Apache-2.0 | streamich/memfs |
| @jsonjoy.com/fs-node-utils | 4.78.1 | Apache-2.0 | streamich/memfs |
| @jsonjoy.com/fs-print | 4.78.1 | Apache-2.0 | streamich/memfs |
| @jsonjoy.com/fs-snapshot | 4.78.1 | Apache-2.0 | streamich/memfs |
| @jsonjoy.com/json-pack | 1.21.0 | Apache-2.0 | jsonjoy-com/json-pack |
| @jsonjoy.com/json-pointer | 17.67.0 | Apache-2.0 | jsonjoy-com/json-pointer |
| @jsonjoy.com/util | 1.9.0 | Apache-2.0 | jsonjoy-com/util |
| @modelcontextprotocol/sdk | 1.30.0 | MIT | https://github.com/modelcontextprotocol/typescript-sdk |
| @next/env | 16.3.5 | MIT | https://github.com/vercel/next.js |
| @next/swc-win32-x64-msvc | 16.3.5 | MIT | https://github.com/vercel/next.js |
| @phc/format | 1.0.0 | MIT | github:simonepri/phc-format |
| @pinojs/redact | 0.4.0 | MIT | https://github.com/pinojs/redact |
| @playwright/test | 1.63.0 | Apache-2.0 | https://github.com/microsoft/playwright |
| @protobufjs/aspromise | 1.1.2 | BSD-3-Clause | https://github.com/dcodeIO/protobuf.js |
| @protobufjs/base64 | 1.1.2 | BSD-3-Clause | https://github.com/dcodeIO/protobuf.js |
| @protobufjs/codegen | 2.0.5 | BSD-3-Clause | https://github.com/dcodeIO/protobuf.js |
| @protobufjs/eventemitter | 1.1.1 | BSD-3-Clause | https://github.com/dcodeIO/protobuf.js |
| @protobufjs/fetch | 1.1.1 | BSD-3-Clause | https://github.com/dcodeIO/protobuf.js |
| @protobufjs/float | 1.0.2 | BSD-3-Clause | https://github.com/dcodeIO/protobuf.js |
| @protobufjs/path | 1.1.2 | BSD-3-Clause | https://github.com/dcodeIO/protobuf.js |
| @protobufjs/pool | 1.1.0 | BSD-3-Clause | https://github.com/dcodeIO/protobuf.js |
| @protobufjs/utf8 | 1.1.2 | BSD-3-Clause | https://github.com/protobufjs/protobuf.js |
| @rollup/rollup-win32-x64-gnu | 4.63.4 | MIT | https://github.com/rollup/rollup |
| @rollup/rollup-win32-x64-msvc | 4.63.4 | MIT | https://github.com/rollup/rollup |
| @smithy/core | 3.34.1 | Apache-2.0 | https://github.com/smithy-lang/smithy-typescript |
| @smithy/credential-provider-imds | 4.5.2 | Apache-2.0 | https://github.com/smithy-lang/smithy-typescript |
| @smithy/fetch-http-handler | 5.8.0 | Apache-2.0 | https://github.com/smithy-lang/smithy-typescript |
| @smithy/node-http-handler | 4.12.1 | Apache-2.0 | https://github.com/smithy-lang/smithy-typescript |
| @smithy/signature-v4 | 5.7.3 | Apache-2.0 | https://github.com/smithy-lang/smithy-typescript |
| @smithy/types | 4.18.0 | Apache-2.0 | https://github.com/smithy-lang/smithy-typescript |
| @swc/core | 1.16.2 | Apache-2.0 | https://github.com/swc-project/swc |
| @swc/core-win32-x64-msvc | 1.16.2 | Apache-2.0 AND MIT | https://github.com/swc-project/swc |
| @swc/counter | 0.1.3 | Apache-2.0 | https://github.com/swc-project/pkgs |
| @swc/helpers | 0.5.23 | Apache-2.0 | https://github.com/swc-project/swc |
| @swc/types | 0.1.28 | Apache-2.0 | https://github.com/swc-project/swc |
| @tailwindcss/node | 4.3.3 | MIT | https://github.com/tailwindlabs/tailwindcss |
| @tailwindcss/oxide | 4.3.3 | MIT | https://github.com/tailwindlabs/tailwindcss |
| @tailwindcss/oxide-win32-x64-msvc | 4.3.3 | MIT | https://github.com/tailwindlabs/tailwindcss |
| @tailwindcss/postcss | 4.3.3 | MIT | https://github.com/tailwindlabs/tailwindcss |
| @temporalio/activity | 1.23.0 | MIT | https://github.com/temporalio/sdk-typescript |
| @temporalio/client | 1.23.0 | MIT | https://github.com/temporalio/sdk-typescript |
| @temporalio/common | 1.23.0 | MIT | https://github.com/temporalio/sdk-typescript |
| @temporalio/core-bridge | 1.23.0 | MIT | https://github.com/temporalio/sdk-typescript |
| @temporalio/nexus | 1.23.0 | MIT | https://github.com/temporalio/sdk-typescript |
| @temporalio/proto | 1.23.0 | MIT | https://github.com/temporalio/sdk-typescript |
| @temporalio/testing | 1.23.0 | MIT | https://github.com/temporalio/sdk-typescript |
| @temporalio/worker | 1.23.0 | MIT | https://github.com/temporalio/sdk-typescript |
| @temporalio/workflow | 1.23.0 | MIT | https://github.com/temporalio/sdk-typescript |
| @turbo/windows-64 | 2.11.2 | MIT | https://github.com/vercel/turborepo |
| @types/chai | 5.2.3 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/deep-eql | 4.0.2 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/docker-modem | 3.0.6 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/dockerode | 3.3.47 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/estree | 1.0.9 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/json-schema | 7.0.15 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/node | 24.13.6 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/nodemailer | 8.0.2 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/pg | 8.23.1 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/react | 19.3.0 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/react-dom | 19.3.0 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/ssh2 | 1.15.6 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/tar-stream | 3.1.4 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @typescript-eslint/eslint-plugin | 8.70.0 | MIT | https://github.com/typescript-eslint/typescript-eslint |
| @typescript-eslint/parser | 8.70.0 | MIT | https://github.com/typescript-eslint/typescript-eslint |
| @typescript-eslint/project-service | 8.70.0 | MIT | https://github.com/typescript-eslint/typescript-eslint |
| @typescript-eslint/scope-manager | 8.70.0 | MIT | https://github.com/typescript-eslint/typescript-eslint |
| @typescript-eslint/tsconfig-utils | 8.70.0 | MIT | https://github.com/typescript-eslint/typescript-eslint |
| @typescript-eslint/type-utils | 8.70.0 | MIT | https://github.com/typescript-eslint/typescript-eslint |
| @typescript-eslint/types | 8.70.0 | MIT | https://github.com/typescript-eslint/typescript-eslint |
| @typescript-eslint/typescript-estree | 8.70.0 | MIT | https://github.com/typescript-eslint/typescript-eslint |
| @typescript-eslint/utils | 8.70.0 | MIT | https://github.com/typescript-eslint/typescript-eslint |
| @typescript-eslint/visitor-keys | 8.70.0 | MIT | https://github.com/typescript-eslint/typescript-eslint |
| @vitest/expect | 3.2.7 | MIT | https://github.com/vitest-dev/vitest |
| @vitest/mocker | 3.2.7 | MIT | https://github.com/vitest-dev/vitest |
| @vitest/pretty-format | 3.2.7 | MIT | https://github.com/vitest-dev/vitest |
| @vitest/runner | 3.2.7 | MIT | https://github.com/vitest-dev/vitest |
| @vitest/snapshot | 3.2.7 | MIT | https://github.com/vitest-dev/vitest |
| @vitest/spy | 3.2.7 | MIT | https://github.com/vitest-dev/vitest |
| @vitest/utils | 3.2.7 | MIT | https://github.com/vitest-dev/vitest |
| @webassemblyjs/ast | 1.14.1 | MIT | https://github.com/xtuc/webassemblyjs |
| @webassemblyjs/floating-point-hex-parser | 1.13.2 | MIT | https://github.com/xtuc/webassemblyjs |
| @webassemblyjs/helper-api-error | 1.13.2 | MIT | https://github.com/xtuc/webassemblyjs |
| @webassemblyjs/helper-buffer | 1.14.1 | MIT | https://github.com/xtuc/webassemblyjs |
| @webassemblyjs/helper-numbers | 1.13.2 | MIT | https://github.com/xtuc/webassemblyjs |
| @webassemblyjs/helper-wasm-bytecode | 1.13.2 | MIT | https://github.com/xtuc/webassemblyjs |
| @webassemblyjs/helper-wasm-section | 1.14.1 | MIT | https://github.com/xtuc/webassemblyjs |
| @webassemblyjs/ieee754 | 1.13.2 | MIT | https://github.com/xtuc/webassemblyjs |
| @webassemblyjs/leb128 | 1.13.2 | Apache-2.0 | https://github.com/xtuc/webassemblyjs |
| @webassemblyjs/utf8 | 1.13.2 | MIT | https://github.com/xtuc/webassemblyjs |
| @webassemblyjs/wasm-edit | 1.14.1 | MIT | https://github.com/xtuc/webassemblyjs |
| @webassemblyjs/wasm-gen | 1.14.1 | MIT | https://github.com/xtuc/webassemblyjs |
| @webassemblyjs/wasm-opt | 1.14.1 | MIT | https://github.com/xtuc/webassemblyjs |
| @webassemblyjs/wasm-parser | 1.14.1 | MIT | https://github.com/xtuc/webassemblyjs |
| @webassemblyjs/wast-printer | 1.14.1 | MIT | https://github.com/xtuc/webassemblyjs |
| @xtuc/ieee754 | 1.2.0 | BSD-3-Clause | git://github.com/feross/ieee754 |
| @xtuc/long | 4.2.2 | Apache-2.0 | https://github.com/dcodeIO/long.js |
| abort-controller | 3.0.0 | MIT | https://github.com/mysticatea/abort-controller |
| accepts | 2.0.0 | MIT | jshttp/accepts |
| acorn | 8.18.0 | MIT | https://github.com/acornjs/acorn |
| acorn-jsx | 5.3.2 | MIT | https://github.com/acornjs/acorn-jsx |
| agent-base | 7.1.4 | MIT | https://github.com/TooTallNate/proxy-agents |
| ajv | 8.20.0 | MIT | ajv-validator/ajv |
| ajv-formats | 3.0.1 | MIT | https://github.com/ajv-validator/ajv-formats |
| ajv-keywords | 5.1.0 | MIT | https://github.com/epoberezkin/ajv-keywords |
| ansi-regex | 5.0.1 | MIT | chalk/ansi-regex |
| ansi-styles | 4.3.0 | MIT | chalk/ansi-styles |
| argon2 | 0.45.1 | MIT | https://github.com/ranisalt/node-argon2 |
| argparse | 2.0.1 | Python-2.0 | nodeca/argparse |
| asn1 | 0.2.6 | MIT | https://github.com/joyent/node-asn1 |
| assertion-error | 2.0.1 | MIT | git@github.com:chaijs/assertion-error |
| atomic-sleep | 1.0.0 | MIT | https://github.com/davidmarkclements/atomic-sleep |
| b4a | 1.9.0 | Apache-2.0 | https://github.com/holepunchto/b4a |
| balanced-match | 4.0.4 | MIT | git://github.com/juliangruber/balanced-match |
| bare-events | 2.9.2 | Apache-2.0 | https://github.com/holepunchto/bare-events |
| bare-fs | 4.8.1 | Apache-2.0 | https://github.com/holepunchto/bare-fs |
| bare-path | 3.1.2 | Apache-2.0 | https://github.com/holepunchto/bare-path |
| bare-stream | 2.13.4 | Apache-2.0 | https://github.com/holepunchto/bare-stream |
| bare-url | 2.5.4 | Apache-2.0 | https://github.com/holepunchto/bare-url |
| base64-js | 1.5.1 | MIT | git://github.com/beatgammit/base64-js |
| baseline-browser-mapping | 2.11.25 | Apache-2.0 | https://github.com/web-platform-dx/baseline-browser-mapping |
| bcrypt-pbkdf | 1.0.2 | BSD-3-Clause | git://github.com/joyent/node-bcrypt-pbkdf |
| bignumber.js | 9.3.1 | MIT | https://github.com/MikeMcl/bignumber.js |
| bl | 4.1.0 | MIT | https://github.com/rvagg/bl |
| body-parser | 2.3.0 | MIT | expressjs/body-parser |
| bowser | 2.14.1 | MIT | https://github.com/bowser-js/bowser |
| brace-expansion | 1.1.21 | MIT | git://github.com/juliangruber/brace-expansion |
| browserslist | 4.29.0 | MIT | browserslist/browserslist |
| buffer | 5.7.1 | MIT | git://github.com/feross/buffer |
| buffer-equal-constant-time | 1.0.1 | BSD-3-Clause | git@github.com:goinstant/buffer-equal-constant-time.git |
| buffer-from | 1.1.2 | MIT | LinusU/buffer-from |
| buildcheck | 0.0.7 | MIT | http://github.com/mscdex/buildcheck |
| bytes | 3.1.2 | MIT | visionmedia/bytes.js |
| cac | 6.7.14 | MIT | egoist/cac |
| call-bind-apply-helpers | 1.0.2 | MIT | https://github.com/ljharb/call-bind-apply-helpers |
| call-bound | 1.0.4 | MIT | https://github.com/ljharb/call-bound |
| callsites | 3.1.0 | MIT | sindresorhus/callsites |
| caniuse-lite | 1.0.30001810 | CC-BY-4.0 | browserslist/caniuse-lite |
| chai | 5.3.3 | MIT | https://github.com/chaijs/chai |
| chalk | 4.1.2 | MIT | chalk/chalk |
| check-error | 2.1.3 | MIT | ssh://git@github.com/chaijs/check-error |
| chownr | 1.1.4 | ISC | git://github.com/isaacs/chownr |
| chrome-trace-event | 1.0.4 | MIT | github:samccone/chrome-trace-event |
| client-only | 0.0.1 | MIT | https://reactjs.org/ |
| cliui | 8.0.1 | ISC | yargs/cliui |
| color-convert | 2.0.1 | MIT | Qix-/color-convert |
| color-name | 1.1.4 | MIT | git@github.com:colorjs/color-name |
| commander | 2.20.3 | MIT | https://github.com/tj/commander.js |
| concat-map | 0.0.1 | MIT | git://github.com/substack/node-concat-map |
| content-disposition | 1.1.0 | MIT | jshttp/content-disposition |
| content-type | 2.1.0 | MIT | jshttp/content-type |
| cookie | 0.7.2 | MIT | jshttp/cookie |
| cookie-signature | 1.2.2 | MIT | https://github.com/visionmedia/node-cookie-signature |
| cors | 2.8.6 | MIT | expressjs/cors |
| cpu-features | 0.0.10 | MIT | https://github.com/mscdex/cpu-features |
| cross-env | 10.1.0 | MIT | https://github.com/kentcdodds/cross-env |
| cross-spawn | 7.0.6 | MIT | git@github.com:moxystudio/node-cross-spawn |
| csstype | 3.2.3 | MIT | https://github.com/frenic/csstype |
| data-uri-to-buffer | 4.0.1 | MIT | git://github.com/TooTallNate/node-data-uri-to-buffer |
| debug | 4.4.3 | MIT | git://github.com/debug-js/debug |
| deep-eql | 5.0.2 | MIT | git@github.com:chaijs/deep-eql |
| deep-is | 0.1.4 | MIT | http://github.com/thlorenz/deep-is |
| depd | 2.0.0 | MIT | dougwilson/nodejs-depd |
| detect-libc | 2.1.2 | Apache-2.0 | git://github.com/lovell/detect-libc |
| docker-modem | 5.0.7 | Apache-2.0 | http://github.com/apocas/docker-modem |
| dockerode | 5.0.1 | Apache-2.0 | http://github.com/apocas/dockerode |
| dotenv | 17.4.2 | BSD-2-Clause | git://github.com/motdotla/dotenv |
| drizzle-kit | 0.31.10 | MIT | https://github.com/drizzle-team/drizzle-orm |
| drizzle-orm | 0.45.2 | Apache-2.0 | https://github.com/drizzle-team/drizzle-orm |
| dunder-proto | 1.0.1 | MIT | https://github.com/es-shims/dunder-proto |
| ecdsa-sig-formatter | 1.0.11 | Apache-2.0 | ssh://git@github.com/Brightspace/node-ecdsa-sig-formatter |
| ee-first | 1.1.1 | MIT | jonathanong/ee-first |
| electron-to-chromium | 1.5.433 | ISC | https://github.com/Kilian/electron-to-chromium |
| emoji-regex | 8.0.0 | MIT | https://github.com/mathiasbynens/emoji-regex |
| encodeurl | 2.0.0 | MIT | pillarjs/encodeurl |
| end-of-stream | 1.4.5 | MIT | git://github.com/mafintosh/end-of-stream |
| enhanced-resolve | 5.25.1 | MIT | https://github.com/webpack/enhanced-resolve |
| es-define-property | 1.0.1 | MIT | https://github.com/ljharb/es-define-property |
| es-errors | 1.3.0 | MIT | https://github.com/ljharb/es-errors |
| es-module-lexer | 2.3.2 | MIT | https://github.com/guybedford/es-module-lexer |
| es-object-atoms | 1.1.2 | MIT | https://github.com/ljharb/es-object-atoms |
| esbuild | 0.28.2 | MIT | https://github.com/evanw/esbuild |
| escalade | 3.2.0 | MIT | lukeed/escalade |
| escape-html | 1.0.3 | MIT | component/escape-html |
| escape-string-regexp | 4.0.0 | MIT | sindresorhus/escape-string-regexp |
| eslint | 9.39.5 | MIT | eslint/eslint |
| eslint-scope | 8.4.0 | BSD-2-Clause | https://github.com/eslint/js |
| eslint-visitor-keys | 4.2.1 | Apache-2.0 | https://github.com/eslint/js |
| espree | 10.4.0 | BSD-2-Clause | https://github.com/eslint/js |
| esquery | 1.7.0 | BSD-3-Clause | https://github.com/estools/esquery |
| esrecurse | 4.3.0 | BSD-2-Clause | https://github.com/estools/esrecurse |
| estraverse | 5.3.0 | BSD-2-Clause | http://github.com/estools/estraverse |
| estree-walker | 3.0.3 | MIT | https://github.com/Rich-Harris/estree-walker |
| esutils | 2.0.3 | BSD-2-Clause | http://github.com/estools/esutils |
| etag | 1.8.1 | MIT | jshttp/etag |
| event-target-shim | 5.0.1 | MIT | https://github.com/mysticatea/event-target-shim |
| events | 3.3.0 | MIT | git://github.com/Gozala/events |
| events-universal | 1.0.1 | Apache-2.0 | https://github.com/holepunchto/events-universal |
| eventsource | 3.0.7 | MIT | git://git@github.com/EventSource/eventsource |
| eventsource-parser | 3.1.1 | MIT | ssh://git@github.com/rexxars/eventsource-parser |
| expect-type | 1.4.0 | Apache-2.0 | https://github.com/mmkal/expect-type |
| express | 5.2.1 | MIT | expressjs/express |
| express-rate-limit | 8.7.0 | MIT | https://github.com/express-rate-limit/express-rate-limit |
| extend | 3.0.2 | MIT | https://github.com/justmoon/node-extend |
| fast-deep-equal | 3.1.3 | MIT | https://github.com/epoberezkin/fast-deep-equal |
| fast-fifo | 1.3.2 | MIT | https://github.com/mafintosh/fast-fifo |
| fast-json-stable-stringify | 2.1.0 | MIT | git://github.com/epoberezkin/fast-json-stable-stringify |
| fast-levenshtein | 2.0.6 | MIT | https://github.com/hiddentao/fast-levenshtein |
| fast-uri | 3.1.8 | BSD-3-Clause | https://github.com/fastify/fast-uri |
| fdir | 6.5.0 | MIT | https://github.com/thecodrr/fdir |
| fetch-blob | 3.2.0 | MIT | https://github.com/node-fetch/fetch-blob.git |
| file-entry-cache | 8.0.0 | MIT | jaredwray/file-entry-cache |
| finalhandler | 2.1.1 | MIT | pillarjs/finalhandler |
| find-up | 5.0.0 | MIT | sindresorhus/find-up |
| flat-cache | 4.0.1 | MIT | jaredwray/flat-cache |
| flatted | 3.4.4 | ISC | https://github.com/WebReflection/flatted |
| formdata-polyfill | 4.0.10 | MIT | https://jimmywarting@github.com/jimmywarting/FormData |
| forwarded | 0.2.0 | MIT | jshttp/forwarded |
| fresh | 2.0.0 | MIT | jshttp/fresh |
| fs-constants | 1.0.0 | MIT | https://github.com/mafintosh/fs-constants |
| fs-monkey | 1.1.0 | Unlicense | https://github.com/streamich/fs-monkey |
| function-bind | 1.1.2 | MIT | https://github.com/Raynos/function-bind |
| gaxios | 7.3.1 | Apache-2.0 | https://github.com/googleapis/google-cloud-node |
| gcp-metadata | 9.0.4 | Apache-2.0 | https://github.com/googleapis/google-cloud-node |
| get-caller-file | 2.0.5 | ISC | https://github.com/stefanpenner/get-caller-file |
| get-intrinsic | 1.3.0 | MIT | https://github.com/ljharb/get-intrinsic |
| get-proto | 1.0.1 | MIT | https://github.com/ljharb/get-proto |
| get-tsconfig | 4.14.3 | MIT | privatenumber/get-tsconfig |
| glob-parent | 6.0.2 | ISC | gulpjs/glob-parent |
| glob-to-regex.js | 1.3.1 | Apache-2.0 | streamich/glob-to-regex |
| globals | 14.0.0 | MIT | sindresorhus/globals |
| google-auth-library | 11.1.0 | Apache-2.0 | https://github.com/googleapis/google-cloud-node |
| google-logging-utils | 2.0.1 | Apache-2.0 | https://github.com/googleapis/google-cloud-node |
| gopd | 1.2.0 | MIT | https://github.com/ljharb/gopd |
| graceful-fs | 4.2.11 | ISC | https://github.com/isaacs/node-graceful-fs |
| has-flag | 4.0.0 | MIT | sindresorhus/has-flag |
| has-symbols | 1.1.0 | MIT | git://github.com/inspect-js/has-symbols |
| hasown | 2.0.4 | MIT | https://github.com/inspect-js/hasOwn |
| heap-js | 2.7.1 | BSD-3-Clause | ssh://git@github.com/ignlg/heap-js |
| hono | 4.13.7 | MIT | https://github.com/honojs/hono |
| http-errors | 2.0.1 | MIT | jshttp/http-errors |
| https-proxy-agent | 7.0.6 | MIT | https://github.com/TooTallNate/proxy-agents |
| hyperdyperid | 1.2.0 | MIT | streamich/hyperdyperid |
| iconv-lite | 0.6.3 | MIT | git://github.com/ashtuchkin/iconv-lite |
| ieee754 | 1.2.1 | BSD-3-Clause | git://github.com/feross/ieee754 |
| ignore | 7.0.9 | MIT | https://github.com/kaelzhang/node-ignore |
| import-fresh | 3.3.1 | MIT | sindresorhus/import-fresh |
| imurmurhash | 0.1.4 | MIT | https://github.com/jensyt/imurmurhash-js |
| inherits | 2.0.4 | ISC | git://github.com/isaacs/inherits |
| ip-address | 10.7.2 | MIT | https://github.com/beaugunderson/ip-address |
| ipaddr.js | 1.9.1 | MIT | git://github.com/whitequark/ipaddr.js |
| is-extglob | 2.1.1 | MIT | jonschlinkert/is-extglob |
| is-fullwidth-code-point | 3.0.0 | MIT | sindresorhus/is-fullwidth-code-point |
| is-glob | 4.0.3 | MIT | micromatch/is-glob |
| is-promise | 4.0.0 | MIT | https://github.com/then/is-promise |
| isexe | 2.0.0 | ISC | https://github.com/isaacs/isexe |
| jest-worker | 27.5.1 | MIT | https://github.com/facebook/jest |
| jiti | 2.7.0 | MIT | unjs/jiti |
| jose | 6.2.12 | MIT | panva/jose |
| js-tokens | 9.0.1 | MIT | lydell/js-tokens |
| js-yaml | 4.3.2 | MIT | nodeca/js-yaml |
| json-bigint | 1.0.0 | MIT | git@github.com:sidorares/json-bigint |
| json-buffer | 3.0.1 | MIT | git://github.com/dominictarr/json-buffer |
| json-schema-traverse | 1.0.0 | MIT | https://github.com/epoberezkin/json-schema-traverse |
| json-schema-typed | 8.0.2 | BSD-2-Clause | https://github.com/RemyRylan/json-schema-typed |
| json-stable-stringify-without-jsonify | 1.0.1 | MIT | git://github.com/samn/json-stable-stringify |
| jwa | 2.0.1 | MIT | git://github.com/brianloveswords/node-jwa |
| jws | 4.0.1 | MIT | git://github.com/brianloveswords/node-jws |
| keyv | 4.5.4 | MIT | https://github.com/jaredwray/keyv |
| levn | 0.4.1 | MIT | git://github.com/gkz/levn |
| lightningcss | 1.32.0 | MPL-2.0 | https://github.com/parcel-bundler/lightningcss |
| lightningcss-win32-x64-msvc | 1.32.0 | MPL-2.0 | https://github.com/parcel-bundler/lightningcss |
| locate-path | 6.0.0 | MIT | sindresorhus/locate-path |
| lodash.camelcase | 4.3.0 | MIT | lodash/lodash |
| lodash.merge | 4.6.2 | MIT | lodash/lodash |
| long | 5.3.2 | Apache-2.0 | https://github.com/dcodeIO/long.js |
| loupe | 3.2.1 | MIT | https://github.com/chaijs/loupe |
| magic-string | 0.30.21 | MIT | https://github.com/Rich-Harris/magic-string |
| math-intrinsics | 1.1.0 | MIT | https://github.com/es-shims/math-intrinsics |
| media-typer | 1.1.1 | MIT | jshttp/media-typer |
| memfs | 4.78.1 | Apache-2.0 | https://github.com/streamich/memfs |
| merge-descriptors | 2.0.0 | MIT | sindresorhus/merge-descriptors |
| merge-stream | 2.0.0 | MIT | grncdr/merge-stream |
| mime-db | 1.54.0 | MIT | jshttp/mime-db |
| mime-types | 3.0.2 | MIT | jshttp/mime-types |
| minimatch | 3.1.5 | ISC | git://github.com/isaacs/minimatch |
| minimizer-webpack-plugin | 5.11.0 | MIT | webpack/minimizer-webpack-plugin |
| mkdirp-classic | 0.5.3 | MIT | https://github.com/mafintosh/mkdirp-classic |
| ms | 2.1.3 | MIT | vercel/ms |
| nan | 2.29.0 | MIT | git://github.com/nodejs/nan |
| nanoid | 3.3.19 | MIT | ai/nanoid |
| natural-compare | 1.4.0 | MIT | git://github.com/litejs/natural-compare-lite.git |
| negotiator | 1.1.0 | MIT | jshttp/negotiator |
| next | 16.3.5 | MIT | vercel/next.js |
| nexus-rpc | 0.0.3 | MIT | https://github.com/nexus-rpc/sdk-typescript |
| node-addon-api | 8.9.2 | MIT | git://github.com/nodejs/node-addon-api |
| node-domexception | 1.0.0 | MIT | https://github.com/jimmywarting/node-domexception |
| node-fetch | 3.3.2 | MIT | https://github.com/node-fetch/node-fetch |
| node-gyp-build | 4.8.4 | MIT | https://github.com/prebuild/node-gyp-build |
| node-releases | 2.0.56 | MIT | https://github.com/chicoxyzzy/node-releases |
| nodemailer | 10.0.10 | MIT-0 | https://github.com/nodemailer/nodemailer |
| object-assign | 4.1.1 | MIT | sindresorhus/object-assign |
| object-inspect | 1.13.4 | MIT | git://github.com/inspect-js/object-inspect |
| on-exit-leak-free | 2.1.2 | MIT | https://github.com/mcollina/on-exit-or-gc |
| on-finished | 2.4.1 | MIT | jshttp/on-finished |
| once | 1.4.0 | ISC | git://github.com/isaacs/once |
| optionator | 0.9.4 | MIT | git://github.com/gkz/optionator |
| p-limit | 3.1.0 | MIT | sindresorhus/p-limit |
| p-locate | 5.0.0 | MIT | sindresorhus/p-locate |
| parent-module | 1.0.1 | MIT | sindresorhus/parent-module |
| parseurl | 1.3.3 | MIT | pillarjs/parseurl |
| path-exists | 4.0.0 | MIT | sindresorhus/path-exists |
| path-key | 3.1.1 | MIT | sindresorhus/path-key |
| path-to-regexp | 8.4.2 | MIT | https://github.com/pillarjs/path-to-regexp |
| pathe | 2.0.3 | MIT | unjs/pathe |
| pathval | 2.0.1 | MIT | ssh://git@github.com/chaijs/pathval |
| pg | 8.23.0 | MIT | git://github.com/brianc/node-postgres |
| pg-cloudflare | 1.4.0 | MIT | git://github.com/brianc/node-postgres |
| pg-connection-string | 2.14.0 | MIT | git://github.com/brianc/node-postgres |
| pg-int8 | 1.0.1 | ISC | https://github.com/charmander/pg-int8 |
| pg-pool | 3.14.0 | MIT | git://github.com/brianc/node-postgres |
| pg-protocol | 1.16.0 | MIT | git://github.com/brianc/node-postgres |
| pg-types | 2.2.0 | MIT | git://github.com/brianc/node-pg-types |
| pgpass | 1.0.5 | MIT | https://github.com/hoegaarden/pgpass |
| pgvector | 0.2.1 | MIT | https://github.com/pgvector/pgvector-node |
| picocolors | 1.1.1 | ISC | alexeyraspopov/picocolors |
| picomatch | 4.0.7 | MIT | micromatch/picomatch |
| pino | 10.3.1 | MIT | https://github.com/pinojs/pino |
| pino-abstract-transport | 3.0.0 | MIT | https://github.com/pinojs/pino-abstract-transport |
| pino-std-serializers | 7.1.0 | MIT | ssh://git@github.com/pinojs/pino-std-serializers |
| pkce-challenge | 5.0.1 | MIT | https://github.com/crouchcd/pkce-challenge |
| playwright | 1.63.0 | Apache-2.0 | https://github.com/microsoft/playwright |
| playwright-core | 1.63.0 | Apache-2.0 | https://github.com/microsoft/playwright |
| postcss | 8.5.28 | MIT | postcss/postcss |
| postgres-array | 2.0.0 | MIT | bendrucker/postgres-array |
| postgres-bytea | 1.0.1 | MIT | bendrucker/postgres-bytea |
| postgres-date | 1.0.7 | MIT | bendrucker/postgres-date |
| postgres-interval | 1.2.0 | MIT | bendrucker/postgres-interval |
| prelude-ls | 1.2.1 | MIT | git://github.com/gkz/prelude-ls |
| process-warning | 5.1.0 | MIT | https://github.com/fastify/process-warning |
| protobufjs | 8.8.0 | BSD-3-Clause | protobufjs/protobuf.js |
| proxy-addr | 2.0.8 | MIT | jshttp/proxy-addr |
| pump | 3.0.4 | MIT | git://github.com/mafintosh/pump.git |
| punycode | 2.3.1 | MIT | https://github.com/mathiasbynens/punycode.js |
| qs | 6.16.0 | BSD-3-Clause | https://github.com/ljharb/qs |
| quick-format-unescaped | 4.0.4 | MIT | https://github.com/davidmarkclements/quick-format |
| range-parser | 1.3.0 | MIT | jshttp/range-parser |
| raw-body | 3.0.2 | MIT | stream-utils/raw-body |
| react | 19.3.0 | MIT | https://github.com/react/react |
| react-dom | 19.3.0 | MIT | https://github.com/react/react |
| readable-stream | 3.6.2 | MIT | git://github.com/nodejs/readable-stream |
| real-require | 1.0.0 | MIT | https://github.com/pinojs/real-require |
| require-directory | 2.1.1 | MIT | git://github.com/troygoode/node-require-directory |
| require-from-string | 2.0.2 | MIT | floatdrop/require-from-string |
| resolve-from | 4.0.0 | MIT | sindresorhus/resolve-from |
| resolve-pkg-maps | 1.0.0 | MIT | privatenumber/resolve-pkg-maps |
| rollup | 4.63.4 | MIT | https://github.com/rollup/rollup |
| router | 2.2.0 | MIT | pillarjs/router |
| rxjs | 7.8.2 | Apache-2.0 | https://github.com/reactivex/rxjs |
| safe-buffer | 5.2.1 | MIT | git://github.com/feross/safe-buffer |
| safe-stable-stringify | 2.5.0 | MIT | https://github.com/BridgeAR/safe-stable-stringify |
| safer-buffer | 2.1.2 | MIT | https://github.com/ChALkeR/safer-buffer |
| scheduler | 0.28.0 | MIT | https://github.com/react/react |
| schema-utils | 4.5.0 | MIT | webpack/schema-utils |
| semver | 7.8.5 | ISC | https://github.com/npm/node-semver |
| send | 1.2.1 | MIT | pillarjs/send |
| serve-static | 2.2.1 | MIT | expressjs/serve-static |
| server-only | 0.0.1 | MIT | https://reactjs.org/ |
| setprototypeof | 1.2.0 | ISC | https://github.com/wesleytodd/setprototypeof |
| sharp | 0.35.4 | Apache-2.0 | https://github.com/lovell/sharp |
| shebang-command | 2.0.0 | MIT | kevva/shebang-command |
| shebang-regex | 3.0.0 | MIT | sindresorhus/shebang-regex |
| side-channel | 1.1.1 | MIT | https://github.com/ljharb/side-channel |
| side-channel-list | 1.0.1 | MIT | https://github.com/ljharb/side-channel-list |
| side-channel-map | 1.0.1 | MIT | https://github.com/ljharb/side-channel-map |
| side-channel-weakmap | 1.0.2 | MIT | https://github.com/ljharb/side-channel-weakmap |
| siginfo | 2.0.0 | ISC | https://github.com/emilbayes/siginfo |
| sonic-boom | 4.2.1 | MIT | https://github.com/pinojs/sonic-boom |
| source-map | 0.7.6 | BSD-3-Clause | http://github.com/mozilla/source-map |
| source-map-js | 1.2.1 | BSD-3-Clause | 7rulnik/source-map-js |
| source-map-loader | 5.0.0 | MIT | webpack-contrib/source-map-loader |
| source-map-support | 0.5.21 | MIT | https://github.com/evanw/node-source-map-support |
| split-ca | 1.0.1 | ISC | https://github.com/bushong1/split-ca |
| split2 | 4.2.0 | ISC | https://github.com/mcollina/split2 |
| ssh2 | 1.17.0 | MIT | http://github.com/mscdex/ssh2 |
| stackback | 0.0.2 | MIT | git://github.com/shtylman/node-stackback |
| statuses | 2.0.2 | MIT | jshttp/statuses |
| std-env | 3.10.0 | MIT | unjs/std-env |
| streamx | 2.28.1 | MIT | https://github.com/mafintosh/streamx |
| string_decoder | 1.3.0 | MIT | git://github.com/nodejs/string_decoder |
| string-width | 4.2.3 | MIT | sindresorhus/string-width |
| strip-ansi | 6.0.1 | MIT | chalk/strip-ansi |
| strip-json-comments | 3.1.1 | MIT | sindresorhus/strip-json-comments |
| strip-literal | 3.1.0 | MIT | https://github.com/antfu/strip-literal |
| styled-jsx | 5.1.6 | MIT | vercel/styled-jsx |
| supports-color | 8.1.1 | MIT | chalk/supports-color |
| swc-loader | 0.2.7 | MIT | https://github.com/swc-project/pkgs |
| tailwindcss | 4.3.3 | MIT | https://github.com/tailwindlabs/tailwindcss |
| tapable | 2.3.3 | MIT | http://github.com/webpack/tapable |
| tar-fs | 2.1.5 | MIT | https://github.com/mafintosh/tar-fs |
| tar-stream | 3.2.1 | MIT | https://github.com/mafintosh/tar-stream |
| teex | 1.0.1 | MIT | https://github.com/mafintosh/teex |
| terser | 5.51.2 | BSD-2-Clause | https://github.com/terser/terser |
| text-decoder | 1.2.7 | Apache-2.0 | https://github.com/holepunchto/text-decoder |
| thingies | 2.6.1 | MIT | streamich/thingies |
| thread-stream | 4.2.0 | MIT | https://github.com/mcollina/thread-stream |
| tinybench | 2.9.0 | MIT | tinylibs/tinybench |
| tinyexec | 0.3.2 | MIT | https://github.com/tinylibs/tinyexec |
| tinyglobby | 0.2.17 | MIT | https://github.com/SuperchupuDev/tinyglobby |
| tinypool | 1.1.1 | MIT | https://github.com/tinylibs/tinypool |
| tinyrainbow | 2.0.0 | MIT | https://github.com/tinylibs/tinyrainbow |
| tinyspy | 4.0.6 | MIT | https://github.com/tinylibs/tinyspy |
| toidentifier | 1.0.1 | MIT | component/toidentifier |
| tree-dump | 1.1.0 | Apache-2.0 | streamich/tree-dump |
| ts-api-utils | 2.5.0 | MIT | https://github.com/JoshuaKGoldberg/ts-api-utils |
| tslib | 2.8.1 | 0BSD | https://github.com/Microsoft/tslib |
| tsx | 4.23.15 | MIT | privatenumber/tsx |
| turbo | 2.11.2 | MIT | https://github.com/vercel/turborepo |
| tweetnacl | 0.14.5 | Unlicense | https://github.com/dchest/tweetnacl-js |
| type-check | 0.4.0 | MIT | git://github.com/gkz/type-check |
| type-is | 2.1.0 | MIT | jshttp/type-is |
| typescript | 5.9.3 | Apache-2.0 | https://github.com/microsoft/TypeScript |
| typescript-eslint | 8.70.0 | MIT | https://github.com/typescript-eslint/typescript-eslint |
| undici-types | 7.18.2 | MIT | https://github.com/nodejs/undici |
| unionfs | 4.6.0 | NOT DECLARED | https://github.com/streamich/unionfs |
| unpipe | 1.0.0 | MIT | stream-utils/unpipe |
| update-browserslist-db | 1.3.3 | MIT | browserslist/update-db |
| uri-js | 4.4.1 | BSD-2-Clause | http://github.com/garycourt/uri-js |
| util-deprecate | 1.0.2 | MIT | git://github.com/TooTallNate/util-deprecate |
| uuid | 11.1.1 | MIT | https://github.com/uuidjs/uuid |
| vary | 1.1.2 | MIT | jshttp/vary |
| vite | 7.3.6 | MIT | https://github.com/vitejs/vite |
| vite-node | 3.2.4 | MIT | https://github.com/vitest-dev/vitest |
| vitest | 3.2.7 | MIT | https://github.com/vitest-dev/vitest |
| watchpack | 2.5.2 | MIT | https://github.com/webpack/watchpack |
| web-streams-polyfill | 3.3.3 | MIT | https://github.com/MattiasBuelens/web-streams-polyfill |
| webpack | 5.111.1 | MIT | https://github.com/webpack/webpack |
| webpack-sources | 3.5.1 | MIT | https://github.com/webpack/webpack-sources |
| which | 2.0.2 | ISC | git://github.com/isaacs/node-which |
| why-is-node-running | 2.3.0 | MIT | https://github.com/mafintosh/why-is-node-running |
| word-wrap | 1.2.5 | MIT | jonschlinkert/word-wrap |
| wrap-ansi | 7.0.0 | MIT | chalk/wrap-ansi |
| wrappy | 1.0.2 | ISC | https://github.com/npm/wrappy |
| xtend | 4.0.2 | MIT | git://github.com/Raynos/xtend.git |
| y18n | 5.0.8 | ISC | yargs/y18n |
| yargs | 17.7.3 | MIT | https://github.com/yargs/yargs |
| yargs-parser | 21.1.1 | ISC | https://github.com/yargs/yargs-parser |
| yocto-queue | 0.1.0 | MIT | sindresorhus/yocto-queue |
| zod | 4.6.5 | MIT | https://github.com/colinhacks/zod |
| zod-to-json-schema | 3.25.2 | ISC | https://github.com/StefanTerdell/zod-to-json-schema |

---

This file is generated, not hand-written: steward relies on the accuracy of the installed graph rather than on a curated list.
