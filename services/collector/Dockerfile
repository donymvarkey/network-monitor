FROM node:22-alpine
# Linux tools: iputils (ping), iproute2 (ip neigh), arp-scan (active ARP), nmap (optional), ieee-data equivalent via OUI file
RUN apk add --no-cache iputils iproute2 arp-scan nmap libcap \
 && setcap cap_net_raw+ep /usr/sbin/arp-scan \
 && setcap cap_net_raw+ep /usr/bin/nmap \
 && wget -qO /usr/share/oui.txt https://standards-oui.ieee.org/oui/oui.txt || true
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile=false
WORKDIR /repo/services/collector
ENV NODE_ENV=production OUI_FILE=/usr/share/oui.txt
USER node
CMD ["pnpm", "exec", "tsx", "src/index.ts"]
