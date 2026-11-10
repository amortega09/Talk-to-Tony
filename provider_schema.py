"""Adapt optional draft fields to OpenAI's required, nullable wire format."""
import copy
import re


def explicit_work_details(draft, text, catalog):
    items = [i for i in draft.get('items', []) if i.get('category') == 'work']
    if len(items) != 1 or re.search(r"\b(?:not|don't|do not|except|without)\b", text, re.I):
        return draft
    def named(name, prefix):
        return isinstance(name, str) and re.search(r'\b' + prefix + r'\s+(?:company\s+|project\s+|task\s+)?' + re.escape(name) + r'(?!\w)', text, re.I)
    matches = [c for c in (catalog or []) if isinstance(c, dict) and named(c.get('name'), r'(?:for|at|company|employer)')]
    if len(matches) == 1:
        projects = [p for p in matches[0].get('projects', []) if named(p, r'(?:on|project|task)')]
        if len(projects) == 1:
            items[0]['details'] = {**items[0].get('details', {}), 'company': matches[0]['name'], 'project': projects[0]}
    return draft


def allows_null(schema):
    kind = schema.get('type', [])
    return kind == 'null' or (isinstance(kind, list) and 'null' in kind) or None in schema.get('enum', []) or any(allows_null(s) for s in schema.get('anyOf', []))


def strict_schema(schema):
    result = copy.deepcopy(schema)
    for key in ['uniqueItems', 'minLength', 'maxLength']:
        result.pop(key, None)
    if 'const' in result:
        result['enum'] = [result.pop('const')]
    if 'enum' in result and 'type' not in result:
        result['type'] = list(dict.fromkeys('null' if v is None else 'boolean' if isinstance(v, bool) else 'number' if isinstance(v, (int, float)) else 'string' for v in result['enum']))
    if 'oneOf' in result:
        result['anyOf'] = result.pop('oneOf')
    if 'anyOf' in result:
        result['anyOf'] = [strict_schema(s) for s in result['anyOf']]
    if 'items' in result:
        result['items'] = strict_schema(result['items'])
    if 'properties' in result:
        result['properties'] = {k: strict_schema(v) if k in schema.get('required', []) or allows_null(v) else {'anyOf': [strict_schema(v), {'type': 'null'}]} for k, v in result['properties'].items()}
        result['required'] = list(result['properties'])
        result['additionalProperties'] = False
    return result


def from_wire(value, schema):
    if isinstance(value, list):
        return [from_wire(v, schema.get('items', {})) for v in value]
    if isinstance(value, dict):
        branches = schema.get('oneOf', schema.get('anyOf', []))
        if branches:
            selected = next((s for s in branches if s.get('properties', {}).get('type', {}).get('const') == value.get('type') or value.get('type') in s.get('properties', {}).get('type', {}).get('enum', [])), None)
            if selected:
                return from_wire(value, selected)
        properties = schema.get('properties', {})
        return {k: from_wire(v, properties.get(k, {})) for k, v in value.items() if not (v is None and k in properties and k not in schema.get('required', []) and not allows_null(properties[k]))}
    return value
