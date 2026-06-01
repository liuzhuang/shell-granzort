import test from 'node:test'
import assert from 'node:assert/strict'
import { convertScriptToTemplate } from './script-to-template'

const SAMPLE_SCRIPT = `cd platform-admin-front

echo "开始备份服务器文件"
ssh -i /Users/liuzhuang/project/zhianxin/key/baidu.pem root@180.76.225.24 "cp -r /data/web/platform-admin-front/dist /data/web/platform-admin-front/dist_$(date +%Y%m%d%H%M)"

echo "开始上传压缩包到服务器"
scp -i /Users/liuzhuang/project/zhianxin/key/baidu.pem /Users/liuzhuang/project/zhianxin/platform-admin-front/dist.tar.gz root@180.76.225.24:/data/web/platform-admin-front/`

test('convertScriptToTemplate uses project and key display names when config matches', () => {
  const projectPath = '/Users/liuzhuang/project/zhianxin/platform-admin-front'
  const keyPath = '/Users/liuzhuang/project/zhianxin/key/baidu.pem'

  const result = convertScriptToTemplate({
    script: SAMPLE_SCRIPT,
    projectDirectories: [{ id: 'proj-1', name: 'data-pixel-server', path: projectPath }],
    sshKeys: [{ id: 'baidu-prod', path: keyPath, label: '百度PROD' }]
  })

  assert.match(result.content, /cd \{\{data-pixel-server\}\}/)
  assert.match(result.content, /-i \{\{百度PROD\}\}/)
  assert.match(result.content, /\{\{data-pixel-server\}\}dist\.tar\.gz/)
  assert.match(result.content, /root@180\.76\.225\.24/)
  assert.match(result.content, /\/data\/web\/platform-admin-front/)
  assert.doesNotMatch(result.content, /\{\{deployTarget\}\}/)
  assert.doesNotMatch(result.content, /\{\{sshKeyPath\}\}/)
  assert.equal(result.sshKeyRef, 'baidu-prod')
  assert.equal(result.matchedProjectId, 'proj-1')
})

test('convertScriptToTemplate keeps original script when nothing matches config', () => {
  const result = convertScriptToTemplate({
    script: SAMPLE_SCRIPT,
    projectDirectories: [],
    sshKeys: []
  })

  assert.equal(result.content, SAMPLE_SCRIPT)
  assert.deepEqual(result.replacements, [])
})

test('convertScriptToTemplate can replace key by basename/id heuristic', () => {
  const result = convertScriptToTemplate({
    script: SAMPLE_SCRIPT,
    projectDirectories: [],
    sshKeys: [{ id: 'baidu-prod', path: '/Users/liuzhuang/.shell-manage/keys/baidu-prod.pem', label: '百度PROD' }]
  })

  assert.match(result.content, /\{\{百度PROD\}\}/)
})

test('convertScriptToTemplate replaces SSH_KEY assignment with key label slot', () => {
  const keyPath = '/Users/liuzhuang/project/zhianxin/key/baidu.pem'
  const script = `SSH_KEY="${keyPath}"\nscp -i "$SSH_KEY" /tmp/a root@1.2.3.4:/tmp/a`

  const result = convertScriptToTemplate({
    script,
    projectDirectories: [],
    sshKeys: [{ id: 'baidu-prod', path: keyPath, label: '百度PROD' }]
  })

  assert.match(result.content, /SSH_KEY="\{\{百度PROD\}\}"/)
  assert.ok(result.content.includes('scp -i "$SSH_KEY"'))
  assert.equal(result.sshKeyRef, 'baidu-prod')
})

test('convertScriptToTemplate replaces quoted project directory names', () => {
  const script = `declare -A PROJECTS_PATH=(\n    ["1"]="platform"\n    ["2"]="platform"\n)\ncd platform`

  const result = convertScriptToTemplate({
    script,
    projectDirectories: [{ id: 'proj-platform', name: 'platform', path: '/Users/you/zhianxin/platform' }],
    sshKeys: []
  })

  assert.match(result.content, /\["1"\]="\{\{platform\}\}"/)
  assert.match(result.content, /cd \{\{platform\}\}/)
  assert.equal(result.matchedProjectId, 'proj-platform')
})
