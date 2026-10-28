# 计划：产物迁到 ./dist，.pi/ 出库

1. [x] 源码 → src/（git mv）
2. [x] 改 build.mjs：outfile ./dist/index.js
3. [x] 重跑 npm run build 生成 dist/index.js（sha256 与旧产物一致）
4. [x] manifest → ./dist/index.js
5. [x] .gitignore 加 /.pi/ 等 agent 目录
6. [x] 同步文档
