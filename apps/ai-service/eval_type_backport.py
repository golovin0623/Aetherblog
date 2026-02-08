from __future__ import annotations

import ast
import typing
from collections.abc import Mapping
from typing import Any


# 安全的 AST 节点白名单 - 只允许类型注解相关的节点
_SAFE_AST_NODES = (
    ast.Expression,  # 顶层表达式
    ast.Name,        # 变量名如 str, int, None
    ast.Attribute,   # 属性访问如 typing.Optional
    ast.Subscript,   # 下标访问如 List[str], Dict[str, int]
    ast.Tuple,       # 元组（用于多类型参数）
    ast.List,        # 列表（某些类型表达式）
    ast.Constant,    # 常量如 None, 字符串字面量
    ast.Load,        # 加载上下文
    ast.BinOp,       # 二元操作（用于 Union: X | Y）
    ast.BitOr,       # | 操作符
)

# Python 3.8 兼容：旧版本使用 NameConstant, Str, Num 等
try:
    _SAFE_AST_NODES = _SAFE_AST_NODES + (ast.NameConstant, ast.Str, ast.Num, ast.Ellipsis)  # type: ignore[attr-defined]
except AttributeError:
    pass  # Python 3.9+ 已移除这些节点类型


class UnsafeTypeExpressionError(Exception):
    """类型表达式包含不安全的 AST 节点"""
    pass


def _validate_safe_ast(node: ast.AST, expression: str) -> None:
    """
    验证 AST 树只包含安全的类型注解节点。
    
    Args:
        node: 要验证的 AST 节点
        expression: 原始表达式（用于错误消息）
    
    Raises:
        UnsafeTypeExpressionError: 如果发现不安全的节点
    """
    if not isinstance(node, _SAFE_AST_NODES):
        raise UnsafeTypeExpressionError(
            f"类型表达式包含不安全的 AST 节点: {type(node).__name__}. "
            f"表达式: {expression!r}"
        )
    
    # 递归检查所有子节点
    for child in ast.iter_child_nodes(node):
        _validate_safe_ast(child, expression)


class _UnionSyntaxTransformer(ast.NodeTransformer):
    def visit_BinOp(self, node: ast.BinOp) -> ast.AST:
        node = self.generic_visit(node)
        if isinstance(node.op, ast.BitOr):
            members = self._collect_union_members(node)
            union_value = ast.Attribute(
                value=ast.Name(id="typing", ctx=ast.Load()),
                attr="Union",
                ctx=ast.Load(),
            )
            union_slice: ast.AST
            if len(members) == 1:
                union_slice = members[0]
            else:
                union_slice = ast.Tuple(elts=members, ctx=ast.Load())
            return ast.copy_location(
                ast.Subscript(value=union_value, slice=union_slice, ctx=ast.Load()),
                node,
            )
        return node

    def _collect_union_members(self, node: ast.AST) -> list[ast.AST]:
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.BitOr):
            return self._collect_union_members(node.left) + self._collect_union_members(node.right)
        return [node]


def _rewrite_union_syntax(expression: str) -> ast.Expression:
    tree = ast.parse(expression, mode="eval")
    transformed = _UnionSyntaxTransformer().visit(tree)
    return ast.fix_missing_locations(typing.cast(ast.Expression, transformed))


def eval_type_backport(
    value: Any,
    globalns: Mapping[str, Any] | None = None,
    localns: Mapping[str, Any] | None = None,
    try_default: bool = False,
) -> Any:
    namespace: dict[str, Any] = {"typing": typing}
    if globalns is not None:
        namespace.update(dict(globalns))

    local_namespace: dict[str, Any] = dict(localns) if localns is not None else {}

    try:
        return typing._eval_type(value, namespace, local_namespace)  # type: ignore[attr-defined]
    except TypeError:
        if not isinstance(value, typing.ForwardRef):
            raise

        expression = value.__forward_arg__
        rewritten = _rewrite_union_syntax(expression)
        
        # 安全验证：确保 AST 只包含类型注解相关的安全节点
        _validate_safe_ast(rewritten, expression)
        
        return eval(compile(rewritten, "<eval_type_backport>", "eval"), namespace, local_namespace)

