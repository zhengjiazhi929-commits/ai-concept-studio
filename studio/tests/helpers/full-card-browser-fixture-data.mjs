const chapters=['读取资料','核对范围','更新记录','返回结果'];
const longBody='这里使用完整的中文说明验证卡片能够承载较长内容，流程仍按顺序连接，文字不会被截断，也不会靠缩小字号来勉强放入。';
export const fullCardBrowserFixtures={
  short:{layout:'flow',items:chapters.map(title=>({title,body:'合成案例，保留已确认样式'}))},
  long:{layout:'flow',items:chapters.map(title=>({title:`${title}并确认当前任务适用范围与来源`,body:longBody}))},
  rows:{layout:'input',items:chapters.map(title=>({title:`${title}并确认当前任务适用范围与来源`,body:longBody}))},
};
