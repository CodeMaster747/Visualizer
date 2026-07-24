#!/usr/bin/env bash
#
# One-time host setup for the Visualizer on a fresh Ubuntu 24.04 ARM VM
# (Oracle Cloud Always Free, or any KVM-capable box).
#
# Installs Docker and gVisor (runsc), registers runsc as a Docker runtime, and
# opens the firewall for HTTP/HTTPS. After this, deploy with:
#
#     SANDBOX_RUNTIME=runsc DOMAIN=your.domain GROQ_API_KEY=... \
#         docker compose up -d --build
#
# gVisor's systrap platform needs no nested virtualisation, so it runs on the
# free tier where KVM is not exposed to the guest.
set -euo pipefail

echo "==> Installing Docker"
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER" || true

echo "==> Installing gVisor (runsc)"
(
  set -e
  ARCH=$(uname -m)
  URL="https://storage.googleapis.com/gvisor/releases/release/latest/${ARCH}"
  wget -q "${URL}/runsc" "${URL}/runsc.sha512" \
       "${URL}/containerd-shim-runsc-v1" "${URL}/containerd-shim-runsc-v1.sha512"
  sha512sum -c runsc.sha512 -c containerd-shim-runsc-v1.sha512
  chmod a+rx runsc containerd-shim-runsc-v1
  sudo mv runsc containerd-shim-runsc-v1 /usr/local/bin/
)

echo "==> Registering runsc as a Docker runtime"
# systrap: the software platform, so no /dev/kvm is required inside the free VM.
sudo /usr/local/bin/runsc install -- --platform=systrap
sudo systemctl restart docker

echo "==> Opening the firewall for web traffic"
# Oracle images ship with restrictive iptables; allow 80/443.
sudo iptables -I INPUT -p tcp --dport 80  -j ACCEPT || true
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT || true
sudo netfilter-persistent save 2>/dev/null || true

echo
echo "==> Done. Verify gVisor:"
echo "    docker run --rm --runtime=runsc hello-world"
echo
echo "Then, from the project directory:"
echo "    SANDBOX_RUNTIME=runsc DOMAIN=your.domain GROQ_API_KEY=... docker compose up -d --build"
echo
echo "NOTE: also add ingress rules for 80/443 in the Oracle Cloud console"
echo "      (Networking -> VCN -> Security List), or the ports stay blocked upstream."
