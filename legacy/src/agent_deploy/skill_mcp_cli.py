#!/usr/bin/env python3
"""
Skill & MCP CLI - agent-deploy 扩展命令

提供 Skill/MCP 包的打包、验证、上传、下载、缓存管理功能。

命令:
    agent-deploy skill pack <path> [-o <file>]
    agent-deploy skill verify <file>
    agent-deploy skill upload <path> [-m <url>] [-k <key>] [-f]
    agent-deploy skill download <ref> [-v <ver>] [-o <dir>] [-m <url>]
    agent-deploy skill list --cached
    agent-deploy skill cache clean [--unused-for <days>]

    agent-deploy mcp pack <path> [-o <file>]
    agent-deploy mcp upload <path> [-m <url>] [-k <key>]
    agent-deploy mcp download <ref> [-v <ver>] [-o <dir>] [-m <url>]
    agent-deploy mcp list --cached

    agent-deploy cache status
    agent-deploy cache clean [--all] [--unused-for <days>]
    agent-deploy cache update [--agent <path>] [--dry-run]
"""
import argparse
import json
import os
import shutil
import sys
import tarfile
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx


DEFAULT_MARKET_URL = os.environ.get("MARKET_API_URL", "https://market.aitboy.cn")


# ============================================================
# 打包功能
# ============================================================

def pack_skill(skill_dir: str, output_path: Optional[str] = None) -> str:
    """打包 Skill 目录为 tar.gz"""
    skill_dir = Path(skill_dir).resolve()

    # 验证必需文件
    skill_json_path = skill_dir / "skill.json"
    if not skill_json_path.exists():
        raise FileNotFoundError(f"skill.json not found in {skill_dir}")

    with open(skill_json_path, "r", encoding="utf-8") as f:
        skill_json = json.load(f)

    identity = skill_json.get("identity", {})
    name = identity.get("name", skill_dir.name)
    version = identity.get("version", "1.0.0")

    # 检查 SKILL.md
    skill_md_path = skill_dir / "SKILL.md"
    content_info = skill_json.get("content", {})
    if content_info.get("source") == "file":
        expected_file = content_info.get("file", "SKILL.md")
        if not (skill_dir / expected_file).exists():
            raise FileNotFoundError(f"Content file '{expected_file}' not found in {skill_dir}")
    elif not skill_md_path.exists():
        # 如果没有 content 字段，默认需要 SKILL.md
        if "content" not in skill_json:
            raise FileNotFoundError(f"SKILL.md not found in {skill_dir}")

    # 生成输出路径
    if output_path is None:
        output_path = f"{name}-skill-v{version}.tar.gz"
    output_path = Path(output_path).resolve()

    # 打包
    with tarfile.open(output_path, "w:gz") as tar:
        tar.add(skill_dir, arcname=f"{name}-v{version}")

    # 检查大小
    size_mb = output_path.stat().st_size / (1024 * 1024)
    if size_mb > 10:
        print(f"Warning: Package size ({size_mb:.1f}MB) exceeds 10MB limit", file=sys.stderr)

    print(f"Packed skill: {output_path} ({size_mb:.2f} MB)")
    return str(output_path)


def pack_mcp_server(mcp_dir: str, output_path: Optional[str] = None) -> str:
    """打包 MCP Server 目录为 tar.gz"""
    mcp_dir = Path(mcp_dir).resolve()

    # 验证必需文件
    mcp_server_json_path = mcp_dir / "mcp-server.json"
    if not mcp_server_json_path.exists():
        raise FileNotFoundError(f"mcp-server.json not found in {mcp_dir}")

    with open(mcp_server_json_path, "r", encoding="utf-8") as f:
        mcp_json = json.load(f)

    identity = mcp_json.get("identity", {})
    name = identity.get("name", mcp_dir.name)
    version = identity.get("version", "1.0.0")

    # 检查 mcp-config.json
    config_info = mcp_json.get("config", {})
    if config_info.get("source") == "file":
        expected_file = config_info.get("file", "mcp-config.json")
        if not (mcp_dir / expected_file).exists():
            raise FileNotFoundError(f"Config file '{expected_file}' not found in {mcp_dir}")
    elif not (mcp_dir / "mcp-config.json").exists():
        if "config" not in mcp_json:
            raise FileNotFoundError(f"mcp-config.json not found in {mcp_dir}")

    if output_path is None:
        output_path = f"{name}-mcp-v{version}.tar.gz"
    output_path = Path(output_path).resolve()

    with tarfile.open(output_path, "w:gz") as tar:
        tar.add(mcp_dir, arcname=f"{name}-v{version}")

    size_mb = output_path.stat().st_size / (1024 * 1024)
    if size_mb > 10:
        print(f"Warning: Package size ({size_mb:.1f}MB) exceeds 10MB limit", file=sys.stderr)

    print(f"Packed MCP server: {output_path} ({size_mb:.2f} MB)")
    return str(output_path)


# ============================================================
# 验证功能
# ============================================================

def verify_skill_package(package_path: str) -> Dict[str, Any]:
    """验证 Skill 包"""
    package_path = Path(package_path).resolve()
    if not package_path.exists():
        raise FileNotFoundError(f"Package not found: {package_path}")

    errors = []
    warnings = []

    with tempfile.TemporaryDirectory() as tmpdir:
        extract_dir = Path(tmpdir)
        with tarfile.open(package_path, "r:gz") as tar:
            tar.extractall(extract_dir)

        # 找到实际内容目录
        entries = [e for e in extract_dir.iterdir() if e.is_dir()]
        if len(entries) == 1:
            content_dir = entries[0]
        else:
            content_dir = extract_dir

        # 检查 skill.json
        skill_json_path = content_dir / "skill.json"
        if not skill_json_path.exists():
            errors.append("Missing skill.json")
            return {"valid": False, "errors": errors, "warnings": warnings}

        try:
            with open(skill_json_path, "r", encoding="utf-8") as f:
                skill_json = json.load(f)
        except json.JSONDecodeError as e:
            errors.append(f"Invalid skill.json: {e}")
            return {"valid": False, "errors": errors, "warnings": warnings}

        # 验证必需字段
        identity = skill_json.get("identity", {})
        if not identity.get("name"):
            errors.append("Missing identity.name")
        if not identity.get("version"):
            errors.append("Missing identity.version")

        # 检查 SKILL.md
        content_info = skill_json.get("content", {})
        if content_info.get("source") == "file":
            content_file = content_info.get("file", "SKILL.md")
            if not (content_dir / content_file).exists():
                errors.append(f"Missing content file: {content_file}")
        elif not (content_dir / "SKILL.md").exists() and "content" not in skill_json:
            warnings.append("No SKILL.md found (optional but recommended)")

        # 检查 scripts 可执行性
        scripts = skill_json.get("scripts", {})
        for script_name, script_path in scripts.items():
            full_path = content_dir / script_path
            if not full_path.exists():
                warnings.append(f"Script not found: {script_name} -> {script_path}")

    size_mb = package_path.stat().st_size / (1024 * 1024)
    if size_mb > 10:
        errors.append(f"Package size ({size_mb:.1f}MB) exceeds 10MB limit")

    return {
        "valid": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
        "size_mb": round(size_mb, 2),
    }


def verify_mcp_package(package_path: str) -> Dict[str, Any]:
    """验证 MCP Server 包"""
    package_path = Path(package_path).resolve()
    if not package_path.exists():
        raise FileNotFoundError(f"Package not found: {package_path}")

    errors = []
    warnings = []

    with tempfile.TemporaryDirectory() as tmpdir:
        extract_dir = Path(tmpdir)
        with tarfile.open(package_path, "r:gz") as tar:
            tar.extractall(extract_dir)

        entries = [e for e in extract_dir.iterdir() if e.is_dir()]
        content_dir = entries[0] if len(entries) == 1 else extract_dir

        mcp_server_json_path = content_dir / "mcp-server.json"
        if not mcp_server_json_path.exists():
            errors.append("Missing mcp-server.json")
            return {"valid": False, "errors": errors, "warnings": warnings}

        try:
            with open(mcp_server_json_path, "r", encoding="utf-8") as f:
                mcp_json = json.load(f)
        except json.JSONDecodeError as e:
            errors.append(f"Invalid mcp-server.json: {e}")
            return {"valid": False, "errors": errors, "warnings": warnings}

        identity = mcp_json.get("identity", {})
        if not identity.get("name"):
            errors.append("Missing identity.name")
        if not identity.get("version"):
            errors.append("Missing identity.version")

        # 检查 mcp-config.json
        config_info = mcp_json.get("config", {})
        if config_info.get("source") == "file":
            config_file = config_info.get("file", "mcp-config.json")
            if not (content_dir / config_file).exists():
                errors.append(f"Missing config file: {config_file}")
        elif not (content_dir / "mcp-config.json").exists() and "config" not in mcp_json:
            errors.append("Missing mcp-config.json")

        # 尝试解析 mcp-config.json
        mcp_config_path = content_dir / "mcp-config.json"
        if mcp_config_path.exists():
            try:
                with open(mcp_config_path, "r", encoding="utf-8") as f:
                    json.load(f)
            except json.JSONDecodeError as e:
                errors.append(f"Invalid mcp-config.json: {e}")

    size_mb = package_path.stat().st_size / (1024 * 1024)
    if size_mb > 10:
        errors.append(f"Package size ({size_mb:.1f}MB) exceeds 10MB limit")

    return {
        "valid": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
        "size_mb": round(size_mb, 2),
    }


# ============================================================
# 上传/下载
# ============================================================

async def upload_skill(
    skill_dir: str,
    market_url: str = DEFAULT_MARKET_URL,
    api_key: Optional[str] = None,
    force: bool = False,
) -> Dict[str, Any]:
    """上传 Skill 到市场"""
    package_path = pack_skill(skill_dir)

    try:
        headers = {}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        async with httpx.AsyncClient(timeout=60.0) as client:
            with open(package_path, "rb") as f:
                files = {"file": (Path(package_path).name, f, "application/gzip")}
                data = {"force": "true" if force else "false"}
                response = await client.post(
                    f"{market_url}/api/v1/skills/upload",
                    files=files,
                    data=data,
                    headers=headers,
                )

            if response.status_code == 409:
                raise ValueError("Skill already exists. Use --force to overwrite.")
            response.raise_for_status()
            return response.json()
    finally:
        if os.path.exists(package_path):
            os.unlink(package_path)


async def upload_mcp_server(
    mcp_dir: str,
    market_url: str = DEFAULT_MARKET_URL,
    api_key: Optional[str] = None,
    force: bool = False,
) -> Dict[str, Any]:
    """上传 MCP Server 到市场"""
    package_path = pack_mcp_server(mcp_dir)

    try:
        headers = {}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        async with httpx.AsyncClient(timeout=60.0) as client:
            with open(package_path, "rb") as f:
                files = {"file": (Path(package_path).name, f, "application/gzip")}
                data = {"force": "true" if force else "false"}
                response = await client.post(
                    f"{market_url}/api/v1/mcp-servers/upload",
                    files=files,
                    data=data,
                    headers=headers,
                )

            if response.status_code == 409:
                raise ValueError("MCP Server already exists. Use --force to overwrite.")
            response.raise_for_status()
            return response.json()
    finally:
        if os.path.exists(package_path):
            os.unlink(package_path)


async def download_skill(
    ref: str,
    version: str = "latest",
    output_dir: str = ".",
    market_url: str = DEFAULT_MARKET_URL,
) -> str:
    """从市场下载 Skill"""
    os.makedirs(output_dir, exist_ok=True)
    package_path = os.path.join(output_dir, f"{ref}-v{version}.tar.gz")

    url = f"{market_url}/api/v1/skills/{ref}/download"
    if version != "latest":
        url += f"?version={version}"

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.get(url)
        response.raise_for_status()
        with open(package_path, "wb") as f:
            f.write(response.content)

    # 解压
    extract_dir = os.path.join(output_dir, ref)
    os.makedirs(extract_dir, exist_ok=True)
    with tarfile.open(package_path, "r:gz") as tar:
        tar.extractall(extract_dir)

    os.unlink(package_path)
    print(f"Downloaded skill: {ref}@{version} -> {extract_dir}")
    return extract_dir


async def download_mcp_server(
    ref: str,
    version: str = "latest",
    output_dir: str = ".",
    market_url: str = DEFAULT_MARKET_URL,
) -> str:
    """从市场下载 MCP Server"""
    os.makedirs(output_dir, exist_ok=True)
    package_path = os.path.join(output_dir, f"{ref}-mcp-v{version}.tar.gz")

    url = f"{market_url}/api/v1/mcp-servers/{ref}/download"
    if version != "latest":
        url += f"?version={version}"

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.get(url)
        response.raise_for_status()
        with open(package_path, "wb") as f:
            f.write(response.content)

    extract_dir = os.path.join(output_dir, ref)
    os.makedirs(extract_dir, exist_ok=True)
    with tarfile.open(package_path, "r:gz") as tar:
        tar.extractall(extract_dir)

    os.unlink(package_path)
    print(f"Downloaded MCP server: {ref}@{version} -> {extract_dir}")
    return extract_dir


# ============================================================
# 缓存管理
# ============================================================

class CacheManager:
    """Skill/MCP 缓存管理器"""

    def __init__(self, cache_dir: Optional[str] = None):
        self.cache_dir = cache_dir or os.path.expanduser("~/.agent-hub/cache")
        self.skills_dir = os.path.join(self.cache_dir, "skills")
        self.mcp_dir = os.path.join(self.cache_dir, "mcp-servers")
        self.index_path = os.path.join(self.cache_dir, "index.json")
        self._ensure_dirs()

    def _ensure_dirs(self):
        os.makedirs(self.skills_dir, exist_ok=True)
        os.makedirs(self.mcp_dir, exist_ok=True)

    def _load_index(self) -> Dict[str, Any]:
        if os.path.exists(self.index_path):
            try:
                with open(self.index_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except (json.JSONDecodeError, IOError):
                pass
        return {"skills": {}, "mcp_servers": {}, "version": "1.0.0"}

    def _save_index(self, index: Dict[str, Any]):
        with open(self.index_path, "w", encoding="utf-8") as f:
            json.dump(index, f, indent=2, ensure_ascii=False)

    def status(self) -> Dict[str, Any]:
        """获取缓存状态"""
        index = self._load_index()

        def calc_size(dir_path: str) -> float:
            total = 0
            if os.path.exists(dir_path):
                for root, _, files in os.walk(dir_path):
                    for f in files:
                        total += os.path.getsize(os.path.join(root, f))
            return total / (1024 * 1024)

        return {
            "cache_dir": self.cache_dir,
            "skills": {
                "count": len(index.get("skills", {})),
                "size_mb": round(calc_size(self.skills_dir), 2),
            },
            "mcp_servers": {
                "count": len(index.get("mcp_servers", {})),
                "size_mb": round(calc_size(self.mcp_dir), 2),
            },
            "total_size_mb": round(calc_size(self.cache_dir), 2),
        }

    def list_cached(self, kind: str = "skill") -> List[Dict[str, str]]:
        """列出已缓存的条目"""
        index = self._load_index()
        key = "skills" if kind == "skill" else "mcp_servers"
        results = []
        for entry_key, info in index.get(key, {}).items():
            parts = entry_key.split("@")
            results.append({
                "ref": info.get("ref", parts[0] if parts else ""),
                "version": info.get("version", parts[1] if len(parts) > 1 else ""),
                "path": info.get("path", ""),
                "downloaded_at": info.get("downloaded_at", ""),
            })
        return results

    def clean(self, kind: Optional[str] = None, unused_for_days: Optional[int] = None) -> List[str]:
        """清理缓存"""
        import time
        removed = []
        index = self._load_index()
        cutoff = time.time() - (unused_for_days * 86400) if unused_for_days else 0

        for k, dir_path in [("skills", self.skills_dir), ("mcp_servers", self.mcp_dir)]:
            if kind and k != kind + "s":
                continue
            if not os.path.exists(dir_path):
                continue
            for entry in os.listdir(dir_path):
                entry_path = os.path.join(dir_path, entry)
                if os.path.isdir(entry_path):
                    if unused_for_days:
                        mtime = os.path.getmtime(entry_path)
                        if mtime >= cutoff:
                            continue
                    shutil.rmtree(entry_path)
                    removed.append(entry)
                    if entry in index.get(k, {}):
                        del index[k][entry]

        self._save_index(index)
        return removed

    def clear(self):
        """清空所有缓存"""
        if os.path.exists(self.cache_dir):
            shutil.rmtree(self.cache_dir)
        self._ensure_dirs()
        self._save_index({"skills": {}, "mcp_servers": {}, "version": "1.0.0"})


# ============================================================
# CLI 入口
# ============================================================

def _print_result(result: Dict[str, Any]):
    print(json.dumps(result, indent=2, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser(
        prog="agent-deploy skill/mcp",
        description="Skill & MCP Server packaging and management",
    )
    parser.add_argument("--market-url", "-m", default=DEFAULT_MARKET_URL, help="Market API URL")
    parser.add_argument("--api-key", "-k", default=os.environ.get("MARKET_API_KEY"), help="API Key")

    sub = parser.add_subparsers(dest="command")

    # --- skill 子命令 ---
    skill_parser = sub.add_parser("skill", help="Skill management")
    skill_sub = skill_parser.add_subparsers(dest="skill_cmd")

    # skill pack
    pack_parser = skill_sub.add_parser("pack", help="Pack a skill directory")
    pack_parser.add_argument("path", help="Path to skill directory")
    pack_parser.add_argument("-o", "--output", help="Output file path")

    # skill verify
    verify_parser = skill_sub.add_parser("verify", help="Verify a skill package")
    verify_parser.add_argument("file", help="Path to skill tar.gz file")

    # skill upload
    upload_parser = skill_sub.add_parser("upload", help="Upload skill to market")
    upload_parser.add_argument("path", help="Path to skill directory")
    upload_parser.add_argument("-f", "--force", action="store_true", help="Force overwrite")

    # skill download
    download_parser = skill_sub.add_parser("download", help="Download skill from market")
    download_parser.add_argument("ref", help="Skill reference name")
    download_parser.add_argument("-v", "--version", default="latest", help="Version constraint")
    download_parser.add_argument("-o", "--output", default=".", help="Output directory")

    # skill list
    list_parser = skill_sub.add_parser("list", help="List cached skills")
    list_parser.add_argument("--cached", action="store_true", help="List cached skills")

    # skill cache clean
    cache_clean_parser = skill_sub.add_parser("cache-clean", help="Clean skill cache")
    cache_clean_parser.add_argument("--unused-for", type=int, help="Remove unused for N days")

    # --- mcp 子命令 ---
    mcp_parser = sub.add_parser("mcp", help="MCP Server management")
    mcp_sub = mcp_parser.add_subparsers(dest="mcp_cmd")

    # mcp pack
    mcp_pack = mcp_sub.add_parser("pack", help="Pack an MCP server directory")
    mcp_pack.add_argument("path", help="Path to MCP server directory")
    mcp_pack.add_argument("-o", "--output", help="Output file path")

    # mcp upload
    mcp_upload = mcp_sub.add_parser("upload", help="Upload MCP server to market")
    mcp_upload.add_argument("path", help="Path to MCP server directory")
    mcp_upload.add_argument("-f", "--force", action="store_true", help="Force overwrite")

    # mcp download
    mcp_download = mcp_sub.add_parser("download", help="Download MCP server from market")
    mcp_download.add_argument("ref", help="MCP server reference name")
    mcp_download.add_argument("-v", "--version", default="latest", help="Version constraint")
    mcp_download.add_argument("-o", "--output", default=".", help="Output directory")

    # mcp list
    mcp_list = mcp_sub.add_parser("list", help="List cached MCP servers")
    mcp_list.add_argument("--cached", action="store_true", help="List cached MCP servers")

    # --- cache 子命令 ---
    cache_parser = sub.add_parser("cache", help="Cache management")
    cache_sub = cache_parser.add_subparsers(dest="cache_cmd")

    # cache status
    cache_sub.add_parser("status", help="Show cache status")

    # cache clean
    cache_clean = cache_sub.add_parser("clean", help="Clean cache")
    cache_clean.add_argument("--all", action="store_true", help="Clear all cache")
    cache_clean.add_argument("--unused-for", type=int, help="Remove unused for N days")
    cache_clean.add_argument("--kind", choices=["skill", "mcp"], help="Cache kind to clean")

    args = parser.parse_args()

    import asyncio

    async def _run():
        if args.command == "skill":
            if args.skill_cmd == "pack":
                pack_skill(args.path, args.output)
            elif args.skill_cmd == "verify":
                result = verify_skill_package(args.file)
                _print_result(result)
                if not result["valid"]:
                    sys.exit(1)
            elif args.skill_cmd == "upload":
                result = await upload_skill(
                    args.path, args.market_url, args.api_key, args.force
                )
                _print_result(result)
            elif args.skill_cmd == "download":
                await download_skill(
                    args.ref, args.version, args.output, args.market_url
                )
            elif args.skill_cmd == "list" and args.cached:
                cache = CacheManager()
                for item in cache.list_cached("skill"):
                    print(f"  {item['ref']}@{item['version']} -> {item['path']}")
            elif args.skill_cmd == "cache-clean":
                cache = CacheManager()
                removed = cache.clean(kind="skill", unused_for_days=args.unused_for)
                print(f"Removed {len(removed)} skill cache entries")
                for r in removed:
                    print(f"  - {r}")

        elif args.command == "mcp":
            if args.mcp_cmd == "pack":
                pack_mcp_server(args.path, args.output)
            elif args.mcp_cmd == "upload":
                result = await upload_mcp_server(
                    args.path, args.market_url, args.api_key, args.force
                )
                _print_result(result)
            elif args.mcp_cmd == "download":
                await download_mcp_server(
                    args.ref, args.version, args.output, args.market_url
                )
            elif args.mcp_cmd == "list" and args.cached:
                cache = CacheManager()
                for item in cache.list_cached("mcp"):
                    print(f"  {item['ref']}@{item['version']} -> {item['path']}")

        elif args.command == "cache":
            if args.cache_cmd == "status":
                cache = CacheManager()
                status = cache.status()
                _print_result(status)
            elif args.cache_cmd == "clean":
                cache = CacheManager()
                if args.all:
                    cache.clear()
                    print("All cache cleared")
                else:
                    removed = cache.clean(kind=args.kind, unused_for_days=args.unused_for)
                    print(f"Removed {len(removed)} cache entries")
                    for r in removed:
                        print(f"  - {r}")

    asyncio.run(_run())


if __name__ == "__main__":
    main()
