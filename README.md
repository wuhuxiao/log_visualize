# LLM / UC 日志分析与可视化

把多个 worker 进程的 LLM / UC 日志解析成统一事件模型，并在本地网页中查看请求生命周期、调度行为、UC task 时间线与 Prefix Cache 命中情况。

## 启动方式

```bash
npm install
npm run dev
```

默认会自动加载 `public/samples/demo.log` 和 `public/samples/mixed-workers.log`。

常用命令：

```bash
npm run build
npm test
```

## 项目结构

```text
src/
  anomaly/              异常检测规则
  aggregations/         聚合统计
  normalizer/           请求 / UC task / Prefix Cache 归并与关联
  parser/               头部解析 + 规则化 parser
  sample-data/          前端样例加载入口
  types/                统一数据模型
  ui/
    components/         React 组件
    filtering.ts        视图过滤逻辑
  utils/                时间与统计工具
public/
  samples/              示例日志
```

## 支持的日志类型

当前实现覆盖了这些核心模式：

1. 请求生命周期
   - `Get a new inferRequest from server`
   - `Add request successfully`
   - `Insert a new inferRequest`
   - `Request Prefill Complete`
   - `Finish decode tokenIds`
   - `Get kv release request`
   - `Get a new ControlRequest`
   - `Send Release KV response successfully`
   - `Request life endup / final status`
   - `Can not find sequence group`

2. 调度
   - `Scheduler|Schedule-scheduling`
   - `Scheduler|Schedule-Response`

3. UC / Store
   - `Cache lookup(...) costs ...`
   - `Cache lookup(.../...) in backend costs ...`
   - `Cache task(...,Load|Dump,...) dispatching / start / finished`
   - `Posix task(...,Backend2Cache|Cache2Backend,...) dispatching / finished`
   - `wait / mk_buf / sync / back` 拆分字段

4. Prefix cache
   - `Prefix Cache Reporter`
   - `Prefix Cache Global Reporter`

## 数据模型

统一模型定义在 [src/types/models.ts](/d:/project/log_visualize/src/types/models.ts)。

核心对象：

- `RawLogLine`
- `ParsedEvent`
- `RequestLifecycleEvent`
- `SchedulerEvent`
- `UCTaskEvent`
- `PrefixCacheEvent`
- `NormalizedRequest`
- `NormalizedUCTask`
- `AnomalyRecord`

## 解析规则说明

解析分两层：

1. 头部解析
   - [src/parser/base.ts](/d:/project/log_visualize/src/parser/base.ts)
   - 先识别标准 LLM 日志头和 UC 日志头
   - 提取 `timestamp / pid / tid / module / file:line`

2. 规则解析
   - [src/parser/rules/requestRules.ts](/d:/project/log_visualize/src/parser/rules/requestRules.ts)
   - [src/parser/rules/schedulerRules.ts](/d:/project/log_visualize/src/parser/rules/schedulerRules.ts)
   - [src/parser/rules/ucRules.ts](/d:/project/log_visualize/src/parser/rules/ucRules.ts)
   - [src/parser/rules/prefixCacheRules.ts](/d:/project/log_visualize/src/parser/rules/prefixCacheRules.ts)

这样做的目的不是把所有格式塞进一个大 regex，而是允许后续直接加新的 parser rule。

## 归并与关联规则

1. 请求主键优先级
   - `llmMgrReqId`
   - `EngineReqId`
   - `seqId`

2. UC task 归并
   - 按 `pid + uc kind + taskId` 为主做生命周期拼接
   - `dispatch / start / finish / metrics` 会尽量归并到同一 task

3. Prefix cache 关联
   - 请求级 reporter 会按时间邻近最近的请求进行关联
   - 如果时间窗口内存在歧义，会保留 `confidence=low` 或不关联

4. 无法可靠关联时
   - 不静默丢弃
   - 保留 `uncertain` / `unmatched` 语义

## 异常检测规则

实现位于 [src/anomaly/detect.ts](/d:/project/log_visualize/src/anomaly/detect.ts)。

当前包含这些明确规则：

1. `slow_scheduler_response`
   - `response cost > 1000ms`

2. `sequence_group_missing`
   - 命中 `Can not find sequence group`

3. `request_incomplete`
   - 请求出现开始事件，但没有显式结束事件或 release response

4. `cache_posix_gap`
   - Cache task 总耗时显著大于配对的 Posix task
   - 当前阈值：`ratio >= 2` 且 `delta >= 20ms`

## 页面功能

页面布局：

- 左侧筛选栏
- 中间主图表区
- 右侧详情面板

当前视图：

1. 进程汇总视图
2. 请求列表视图
3. 请求时序视图
4. 调度视图
5. UC task 时间线视图
6. Prefix cache 视图

支持：

- 多文件上传
- 按 `pid / worker / dp rank / event type` 过滤
- 搜索 `llmMgrReqId / EngineReqId / seqId`
- 点击请求联动查看相关 task
- 时间轴缩放
- 导出归一化 JSON
- 异常高亮

## 测试

测试位于 [src/parser/__tests__/analysis.test.ts](/d:/project/log_visualize/src/parser/__tests__/analysis.test.ts)。

覆盖内容：

- 多种日志头解析
- 请求 / Scheduler / UC / Prefix Cache 事件识别
- 请求归并
- Cache / Posix task 配对
- 异常检测

## 后续扩展方式

1. 新增一种日志事件
   - 在 `src/parser/rules/` 下增加新的 rule 文件
   - 在 [src/parser/index.ts](/d:/project/log_visualize/src/parser/index.ts) 注册

2. 新增新的归并逻辑
   - 在 `src/normalizer/` 下新增关联器

3. 新增新的异常规则
   - 在 [src/anomaly/detect.ts](/d:/project/log_visualize/src/anomaly/detect.ts) 中追加规则

4. 提升请求与 UC task 的关联准确率
   - 如果后续日志中暴露更明确的 `reqId / seqId / taskId` 对应关系，可以直接在 normalizer 中把当前时间窗口启发式替换成显式关联

## 当前已知限制

- Prefix Cache Reporter 在样例日志里通常不直接带 `reqId`，所以当前关联是时间窗口启发式，结果会显式标记低置信度。
- 某些 UC task 生命周期只出现部分阶段时，会创建 `uncertain` task，而不是强行拼错。
- 目前图表以工程分析可读性为主，尚未做超大日志量下的虚拟滚动优化。
