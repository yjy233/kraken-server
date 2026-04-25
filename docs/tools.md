# 工具列表

Kraken Agent 内置 5 个本地工具，用于与项目文件系统和 shell 交互。

## 概览

| 工具名 | 功能 | 默认状态 |
|---|---|---|
| `project_overview` | 查看项目结构和重要文件 | ✅ 开启 |
| `read_file` | 读取项目内的 UTF-8 文本文件 | ✅ 开启 |
| `search_files` | 按文本/正则搜索项目文件内容 | ✅ 开启 |
| `write_file` | 写入文件到项目目录 | ❌ 关闭 |
| `shell_command` | 执行 shell 命令 | ❌ 关闭 |

## 开关控制

在 `.env` 中配置：

```bash
ALLOW_SHELL_TOOL=true        # 开启 shell_command
ALLOW_FILE_WRITE_TOOL=true   # 开启 write_file
```

修改后重启服务生效。

## 详细说明

### project_overview

查看当前项目结构，返回重要文件和目录的列表。

**参数：**
- `max_depth` (integer, optional): 目录遍历最大深度，范围 1-5，默认 2

### read_file

读取项目内的 UTF-8 文本文件，支持限制行范围。

**参数：**
- `path` (string, required): 项目相对路径
- `start_line` (integer, optional): 起始行号
- `end_line` (integer, optional): 结束行号

### search_files

在项目中搜索文本或正则匹配的行，返回文件名和匹配内容。

**参数：**
- `pattern` (string, required): 搜索文本或正则表达式
- `max_results` (integer, optional): 最大返回结果数，范围 1-200，默认 50

### write_file

写入 UTF-8 内容到项目文件（需手动开启）。

**参数：**
- `path` (string, required): 项目相对路径
- `content` (string, required): 文件完整内容

### shell_command

在项目目录内执行 shell 命令（需手动开启）。

**参数：**
- `command` (string, required): 要执行的命令
- `timeout_ms` (integer, optional): 超时毫秒数，范围 1000-120000，默认 15000
