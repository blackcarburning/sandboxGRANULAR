window.FS7300_REFERENCE = {
  product: {
    family: "IBM FlashSystem 7300",
    mtm: "4657-924",
    platform: "IBM Storage Virtualize",
    targetCode: "9.1.0.x",
    docsChecked: "2026-06-26",
    sources: [
      {
        title: "IBM FlashSystem 7x00 9.1.1 CLI reference",
        url: "https://www.ibm.com/docs/en/flashsystem-7x00/9.1.1?topic=interface-cli-reference"
      },
      {
        title: "IBM Storage Virtualize Family release notes 9.1.0.x",
        url: "https://public.dhe.ibm.com/storage/san/sanvc/release_notes/91_releasenotes.html"
      },
      {
        title: "IBM V9.1.0.x configuration limits for FlashSystem and SVC",
        url: "https://www.ibm.com/support/pages/v910x-configuration-limits-ibm-flashsystem-and-san-volume-controller"
      }
    ]
  },
  commands: [
    {
      category: "System and code",
      purpose: "Identify the system, software level, limits, time, security posture, and configured management addresses.",
      commands: ["lssystem", "lssystem -delim :", "lssystemip", "lssystemlimits", "lssecurity", "lstimezones", "showtimezone", "lsenclosure", "lsnode", "lsnodecanister", "lsnodevpd"]
    },
    {
      category: "Capacity and pools",
      purpose: "Document usable capacity, pools, arrays, MDisks, drives, and data reduction configuration.",
      commands: ["lssystemcapacity", "lspoolcapacity", "lsmdiskgrp", "lsmdiskgrp -bytes", "lsarray", "lsdrive", "lsdriveclass", "lsmdisk", "lsdependentvdisks"]
    },
    {
      category: "Volumes and mappings",
      purpose: "Document volumes, volume groups, host mappings, provisioning, snapshots, and FlashCopy relationships.",
      commands: ["lsvdisk", "lsvdisk -bytes", "lsvolumegroup", "lsvdiskhostmap", "lsvdiskcopy", "lshostvdiskmap", "lssnapshot", "lssnapshotpolicy", "lsfcmap"]
    },
    {
      category: "Hosts and fabric",
      purpose: "Document host objects, host clusters, initiators, Fibre Channel, NVMe, iSCSI, portsets, and routing.",
      commands: ["lshost", "lshostcluster", "lshostport", "lsfabric", "lsfabricport", "lsportfc", "lstargetportfc", "lsportip", "lsroute", "lsportset", "lsnvmefabric", "lsiscsiauth", "lsiscsiportauth"]
    },
    {
      category: "Replication and HA",
      purpose: "Document partnerships, storage partitions, policies, consistency groups, and relationship health.",
      commands: ["lspartnership", "lspartnershipcandidate", "lspartition", "lsreplicationpolicy", "lsrcrelationship", "lsrcconsistgrp", "ls3sitercconsistgrp", "ls3sitercrelationship"]
    },
    {
      category: "Security and support",
      purpose: "Document encryption, certificates, authentication, users, call home, licences, events, and support data.",
      commands: ["lsencryption", "lsencryptionkey", "lskeyserver", "lssystemcert", "lstruststore", "lscert", "lsuser", "lsusergrp", "lsauthservice", "lsldap", "lssra", "lsemailserver", "lssmtpserver", "lslicense", "lseventlog -alert yes", "lserrorlog", "lsauditlog"]
    }
  ],
  fetchGroups: [
    {
      id: "system",
      label: "System, code and licensing",
      description: "System identity, code level, limits, management IPs, time, security baseline and licensing.",
      selected: true,
      commands: ["lssystem -delim :", "lssystemip -delim :", "lssystemlimits -delim :", "lssystemcapacity -delim :", "lssecurity -delim :", "showtimezone", "lslicense -delim :"]
    },
    {
      id: "hardware",
      label: "Hardware inventory",
      description: "Nodes, canisters, enclosures, arrays, drives and drive classes.",
      selected: true,
      commands: ["lsnode -delim :", "lsnodecanister -delim :", "lsenclosure -delim :", "lsarray -delim :", "lsdrive -delim :", "lsdriveclass -delim :"]
    },
    {
      id: "capacity",
      label: "Pools and capacity",
      description: "Storage pools, MDisks, pool capacity and dependent volume information.",
      selected: true,
      commands: ["lsmdiskgrp -delim :", "lsmdiskgrp -bytes -delim :", "lspoolcapacity -delim :", "lsmdisk -delim :", "lsdependentvdisks -delim :"]
    },
    {
      id: "volumes",
      label: "Volumes, volume groups and snapshots",
      description: "Volumes, volume groups, copies, mappings, snapshots and FlashCopy relationships.",
      selected: true,
      commands: ["lsvdisk -delim :", "lsvdisk -bytes -delim :", "lsvdiskcopy -delim :", "lsvolumegroup -delim :", "lsvdiskhostmap -delim :", "lshostvdiskmap -delim :", "lssnapshot -delim :", "lssnapshotpolicy -delim :", "lsfcmap -delim :"]
    },
    {
      id: "partitions",
      label: "Storage partitions",
      description: "Storage partition inventory and partition-scoped resources.",
      selected: true,
      commands: ["lspartition -delim :", "lspartitioncandidate -delim :"]
    },
    {
      id: "hosts",
      label: "Hosts and SCSI mappings",
      description: "Hosts, host clusters, host ports and classic SCSI mappings.",
      selected: true,
      commands: ["lshost -delim :", "lshostcluster -delim :", "lshostport -delim :", "lshostvdiskmap -delim :"]
    },
    {
      id: "iscsi",
      label: "iSCSI and IP",
      description: "IP ports, portsets, routing, iSCSI authentication and iSCSI storage sessions where available.",
      selected: true,
      commands: ["lsportip -delim :", "lsroute -delim :", "lsportset -delim :", "lsiscsiauth -delim :", "lsiscsiportauth -delim :", "lsiscsistorageport -delim :"]
    },
    {
      id: "nvme",
      label: "NVMe fabrics",
      description: "NVMe fabric hosts, ports and sessions where the installed code exposes them.",
      selected: true,
      commands: ["lsnvmefabric -delim :", "lsnvmehost -delim :", "lsnvmeport -delim :"]
    },
    {
      id: "fc",
      label: "Fibre Channel fabric",
      description: "FC ports, target ports, host fabric visibility and fabric ports.",
      selected: true,
      commands: ["lsportfc -delim :", "lstargetportfc -delim :", "lsfabric -delim :", "lsfabricport -delim :", "lsfcportcandidate -delim :"]
    },
    {
      id: "remote_copy",
      label: "Global Mirror and Remote Copy",
      description: "Classic partnerships, relationship inventory and consistency groups.",
      selected: true,
      commands: ["lspartnership -delim :", "lspartnershipcandidate -delim :", "lsrcrelationship -delim :", "lsrcconsistgrp -delim :", "ls3sitercrelationship -delim :", "ls3sitercconsistgrp -delim :"]
    },
    {
      id: "policy_replication",
      label: "Policy-based replication",
      description: "Replication policies, policy partnerships and partition-aware replication objects.",
      selected: true,
      commands: ["lsreplicationpolicy -delim :", "lspartnership -delim :", "lspartition -delim :", "lsvolumegroup -delim :", "lssnapshotpolicy -delim :"]
    },
    {
      id: "security_support",
      label: "Security, audit and support",
      description: "Encryption, certificates, authentication, call home, SMTP, event, error and audit logs.",
      selected: true,
      commands: ["lsencryption -delim :", "lsencryptionkey -delim :", "lskeyserver -delim :", "lssystemcert -delim :", "lstruststore -delim :", "lscert -delim :", "lsuser -delim :", "lsusergrp -delim :", "lsauthservice -delim :", "lsldap -delim :", "lssra -delim :", "lsemailserver -delim :", "lssmtpserver -delim :", "lscloudcallhome -delim :", "lseventlog -alert yes -delim :", "lserrorlog -delim :", "lsauditlog -delim :"]
    }
  ],
  limits: [
    { area: "System", metric: "I/O groups / control enclosures per system", value: 1, unit: "count", command: "lssystem", field: "IO_group_count" },
    { area: "System", metric: "Active nodes per system", value: 2, unit: "count", command: "lsnode", field: "rows" },
    { area: "System", metric: "Systems per FlashSystem grid", value: 32, unit: "count", command: "lssystem", field: "grid_systems" },
    { area: "System", metric: "Storage partitions per system", value: 32, unit: "count", command: "lspartition", field: "rows" },
    { area: "Pool", metric: "Managed disks per system", value: 4096, unit: "count", command: "lsmdisk", field: "rows" },
    { area: "Pool", metric: "Managed disks per storage pool", value: 128, unit: "count", command: "lsmdisk", field: "rowsByPool" },
    { area: "Pool", metric: "Storage pools per system", value: 1024, unit: "count", command: "lsmdiskgrp", field: "rows" },
    { area: "Pool", metric: "Data reduction pools per system", value: 4, unit: "count", command: "lsmdiskgrp", field: "dataReductionRows" },
    { area: "Volume", metric: "Basic volumes per system", value: 16050, unit: "count", command: "lsvdisk", field: "rows" },
    { area: "Volume", metric: "Volume groups per system", value: 1024, unit: "count", command: "lsvolumegroup", field: "rows" },
    { area: "Volume", metric: "Volumes per volume group", value: 512, unit: "count", command: "lsvdisk", field: "rowsByVolumeGroup" },
    { area: "Volume", metric: "Host mappings per system", value: 64000, unit: "count", command: "lshostvdiskmap", field: "rows" },
    { area: "Host", metric: "Hosts per system", value: 2048, unit: "count", command: "lshost", field: "rows" },
    { area: "Host", metric: "Volume mappings per host", value: 2048, unit: "count", command: "lshostvdiskmap", field: "rowsByHost" },
    { area: "Host", metric: "Host portsets per system", value: 72, unit: "count", command: "lsportset", field: "rows" },
    { area: "Host", metric: "Fibre Channel host ports per system", value: 2048, unit: "count", command: "lshostport", field: "fcRows" },
    { area: "NVMe", metric: "Total NVMe over Fabric hosts per system", value: 256, unit: "count", command: "lsnvmefabric", field: "hosts" },
    { area: "NVMe", metric: "NVMe over FC sessions per FC port", value: 64, unit: "count", command: "lsnvmefabric", field: "sessionsByPort" },
    { area: "Ethernet", metric: "IP addresses per system", value: 512, unit: "count", command: "lsportip", field: "rows" },
    { area: "Replication", metric: "Inter-cluster partnerships per system", value: 3, unit: "count", command: "lspartnership", field: "rows" }
  ],
  sampleCapture: `svcinfo lssystem -delim :
id:name:location:partnership:total_mdisk_capacity:space_in_mdisk_grps:total_free_space:total_vdiskcopy_capacity:total_used_capacity:code_level:console_IP:topology:layer:compression_active:email_reply:fc_io_port_count:iscsi_io_port_count
0000020434:ACME-FS7300:London DC1:fully_configured:188.8TB:188.8TB:41.2TB:142.4TB:88.1TB:9.1.0.6:10.20.30.40:standard:storage:yes:storage@example.com:16:8

svcinfo lsnode -delim :
id:name:UPS_serial_number:WWNN:status:IO_group_id:IO_group_name:config_node:hardware:iscsi_name
1:node1:78D0123:500507680B123456:online:0:io_grp0:yes:4657-924:iqn.1986-03.com.ibm:2145.acme.node1
2:node2:78D0124:500507680B123457:online:0:io_grp0:no:4657-924:iqn.1986-03.com.ibm:2145.acme.node2

svcinfo lssystemcapacity -delim :
total_mdisk_capacity:space_in_mdisk_grps:total_free_space:total_vdiskcopy_capacity:total_used_capacity:real_capacity:used_capacity_before_reduction:written_capacity
188.8TB:188.8TB:41.2TB:142.4TB:88.1TB:142.4TB:151.9TB:84.6TB

svcinfo lsmdiskgrp -delim :
id:name:status:mdisk_count:vdisk_count:capacity:extent_size:free_capacity:virtual_capacity:used_capacity:easy_tier:data_reduction
0:Pool0:online:1:128:94.4TB:1024:20.1TB:188.1TB:44.0TB:auto:yes
1:Pool1:online:1:126:94.4TB:1024:21.1TB:177.6TB:44.1TB:auto:yes

svcinfo lsvdisk -delim :
id:name:IO_group_id:IO_group_name:status:mdisk_grp_id:mdisk_grp_name:capacity:type:FC_id:FC_name:RC_id:RC_name:vdisk_UID:fc_map_count:copy_count:fast_write_state:se_copy:owner_id:owner_name:formatting:encrypt:volume_group_name
0:SQL_001:0:io_grp0:online:0:Pool0:2.00TB:striped:::::60050768028400000000000000000000:0:1:empty:no:::no:yes:SQL
1:SQL_002:0:io_grp0:online:1:Pool1:2.00TB:striped:::::60050768028400000000000000000001:0:1:empty:no:::no:yes:SQL

svcinfo lshost -delim :
id:name:port_count:iogrp_count:status:site_id:site_name:host_cluster_id:host_cluster_name:protocol
0:ESX01:4:1:online:::::scsi
1:ESX02:4:1:online:::::scsi
2:SQL01:2:1:online:::::scsi

svcinfo lshostvdiskmap -delim :
id:name:SCSI_id:host_id:host_name:vdisk_id:vdisk_name:vdisk_UID:IO_group_id:IO_group_name
0:ESX01:0:0:ESX01:0:SQL_001:60050768028400000000000000000000:0:io_grp0
1:SQL01:1:2:SQL01:1:SQL_002:60050768028400000000000000000001:0:io_grp0

svcinfo lspartnership -delim :
id:name:location:partnership:bandwidth:total_mdisk_link_count:available_mdisk_link_count:cluster_ip:chap_secret:status
0:DR-FS7300:remote:fully_configured:500:0:0:10.21.30.40::fully_configured

svcinfo lseventlog -alert yes -delim :
id:status:error_code:description:fixed:timestamp
100:alert:980352:Call home test event:no:260626133000`
};
