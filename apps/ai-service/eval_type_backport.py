from __future__ import annotations

import ast
import typing
from collections.abc import Mapping
from typing import Any


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

        rewritten = _rewrite_union_syntax(value.__forward_arg__)
        return eval(compile(rewritten, "<eval_type_backport>", "eval"), namespace, local_namespace)

