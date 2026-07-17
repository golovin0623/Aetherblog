#!/usr/bin/env python3
from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[2]
GATEWAY_IMAGE = (
    "nginx:1.30.4-trixie@"
    "sha256:5cf90903deda2c5981b8ad05e7617ac010e389f0dde0ac83487c02c509281de6"
)
ADMIN_BASE_IMAGE = (
    "nginxinc/nginx-unprivileged:1.30.4-trixie@"
    "sha256:ed5de4a59d636ea196825a0b7cee5f4819999e4d56672e4e12df5cf686bdd0c5"
)


def read_repo_file(relative_path):
    return (REPO_ROOT / relative_path).read_text(encoding="utf-8")


class DeploymentRuntimeContractTests(unittest.TestCase):
    def test_nginx_runtime_images_are_pinned_to_legacy_kernel_compatible_builds(self):
        compose = read_repo_file("docker-compose.prod.yml")
        admin_dockerfile = read_repo_file("apps/admin/Dockerfile")

        self.assertIn("image: " + GATEWAY_IMAGE, compose)
        self.assertIn("FROM " + ADMIN_BASE_IMAGE + " AS runner", admin_dockerfile)
        self.assertNotIn("image: nginx:alpine", compose)
        self.assertNotIn("FROM nginxinc/nginx-unprivileged:alpine", admin_dockerfile)

    def test_frontend_healthchecks_do_not_depend_on_ipv6_localhost_resolution(self):
        blog_dockerfile = read_repo_file("apps/blog/Dockerfile")
        admin_dockerfile = read_repo_file("apps/admin/Dockerfile")

        self.assertIn("http://127.0.0.1:3000/", blog_dockerfile)
        self.assertIn("http://127.0.0.1:8080/", admin_dockerfile)
        self.assertNotIn("http://localhost:3000/", blog_dockerfile)
        self.assertNotIn("http://localhost:8080/", admin_dockerfile)

    def test_gateway_healthcheck_uses_the_installed_ipv4_client(self):
        compose = read_repo_file("docker-compose.prod.yml")
        gateway = compose.split("  gateway:", 1)[1].split("  postgres:", 1)[0]

        self.assertIn(
            'test: ["CMD", "curl", "--fail", "--silent", "--show-error", '
            '"http://127.0.0.1/health"]',
            gateway,
        )
        self.assertNotIn('test: ["CMD", "wget"', gateway)

    def test_admin_image_enforces_its_read_only_runtime_contract_at_build_time(self):
        admin_dockerfile = read_repo_file("apps/admin/Dockerfile")

        self.assertIn("command -v curl", admin_dockerfile)
        self.assertIn("/tmp/nginx\\.pid", admin_dockerfile)
        self.assertIn("client_body_temp_path", admin_dockerfile)
        self.assertNotIn("apt-get install", admin_dockerfile)

    def test_app_deploys_restart_but_do_not_pull_the_gateway_image(self):
        workflow = read_repo_file(".github/workflows/ci-cd.yml")
        deploy_script = read_repo_file("ops/webhook/deploy.sh")
        compute_block = workflow.split("- name: Compute changed services", 1)[1].split(
            "- name: Print deployment info", 1
        )[0]

        self.assertIn(
            '[[ "${{ needs.detect-changes.outputs.gateway }}" == "true" ]] '
            '&& SERVICES="$SERVICES gateway"',
            compute_block,
        )
        self.assertNotIn("# 任何应用变更都要重启 gateway", compute_block)
        self.assertNotIn('if [ -n "$SERVICES" ] && [[ "$SERVICES" != *gateway* ]]', compute_block)
        self.assertIn('SERVICES="gateway"', compute_block)
        self.assertIn("restart_gateway_if_upstreams_changed", deploy_script)
        self.assertIn(
            'up -d --no-deps --force-recreate "${services[@]}"',
            deploy_script,
        )

    def test_post_deploy_preflight_checks_frontend_health_and_emits_logs(self):
        preflight = read_repo_file("ops/release/preflight.sh")

        self.assertIn("local frontend_services=(blog admin gateway)", preflight)
        self.assertIn("frontend_attempts=25", preflight)
        self.assertIn("compose_container_id()", preflight)
        self.assertIn("ps -q \"$service\" 2>/dev/null | head -n 1", preflight)
        self.assertEqual(preflight.count('compose_container_id "$service"'), 2)
        self.assertIn('logs --tail 80 gateway admin blog', preflight)

    def test_ci_runs_webhook_and_deployment_contract_tests(self):
        workflow = read_repo_file(".github/workflows/ci-cd.yml")

        self.assertIn(
            "python3 -m unittest discover -s ops/webhook -p 'test_*.py'",
            workflow,
        )


if __name__ == "__main__":
    unittest.main()
