<?php
// Minimal Express-style router: register handlers with :param placeholders,
// dispatch by matching the request method + path. Handlers receive an
// associative array of path params (from :name segments) and can read the
// rest of the request (body, query, session) directly from PHP's globals.

class Router
{
    private array $routes = [];

    public function get(string $path, callable $handler): void { $this->add('GET', $path, $handler); }
    public function post(string $path, callable $handler): void { $this->add('POST', $path, $handler); }
    public function patch(string $path, callable $handler): void { $this->add('PATCH', $path, $handler); }
    public function put(string $path, callable $handler): void { $this->add('PUT', $path, $handler); }
    public function delete(string $path, callable $handler): void { $this->add('DELETE', $path, $handler); }

    private function add(string $method, string $path, callable $handler): void
    {
        $pattern = preg_replace('#:([A-Za-z_][A-Za-z0-9_]*)#', '(?P<$1>[^/]+)', $path);
        $this->routes[] = [$method, '#^' . $pattern . '$#', $handler];
    }

    // Returns true if a route matched (and was invoked), false otherwise so
    // the caller can fall through to a 404.
    public function dispatch(string $method, string $uri): bool
    {
        // Matches Express's default behaviour of answering HEAD with the
        // registered GET handler (body discarded by the HTTP layer/client).
        $effectiveMethod = $method === 'HEAD' ? 'GET' : $method;
        foreach ($this->routes as [$m, $pattern, $handler]) {
            if ($m !== $effectiveMethod) continue;
            if (preg_match($pattern, $uri, $matches)) {
                $params = array_filter($matches, fn($k) => is_string($k), ARRAY_FILTER_USE_KEY);
                call_user_func($handler, $params);
                return true;
            }
        }
        return false;
    }
}
