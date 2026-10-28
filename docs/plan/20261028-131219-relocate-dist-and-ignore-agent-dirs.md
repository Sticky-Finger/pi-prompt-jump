# 计划：产物迁到 ./dist，.pi/ 出库

1. 源码 → src/（git mv）
2. 改 build.mjs：outfile ./dist/index.js
3. 重跑 npm run build 生成 dist/index.js
4. manifest → ./dist/index.js
5. .gitignore 加 /.pi/ 等 agent 目录
6. 同步文档
