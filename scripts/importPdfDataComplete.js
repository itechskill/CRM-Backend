const mongoose = require('mongoose');
require('dotenv').config();

const User = require('../models/User');
const Lead = require('../models/Lead');
const Quotation = require('../models/Quotation');
const CustomerPO = require('../models/CustomerPO');
const ProductFile = require('../models/ProductFile');
const SalesOrder = require('../models/SalesOrder');
const DeliveryNote = require('../models/DeliveryNote');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const Deal = require('../models/Deal');
const SalesTarget = require('../models/SalesTarget');

// Raw PDF Data extracted across all 12 pages
const RAW_PDF_ROWS = [
  // Page 1
  { ref: 'S01723', date: '2026-09-07 10:10:02', customer: 'PAKISTAN SERVICES LIMITED', fileNo: '1016 Green', product: '512 GB SSD', total: 147500, status: 'Sales Order' },
  { ref: 'S01722', date: '2026-09-07 07:44:27', customer: 'TRANSSION HOLDINGS', fileNo: '', product: 'Dell Pro 16 PC16250', total: 363000, status: 'Quotation' },
  { ref: 'S01721', date: '2026-09-07 07:41:39', customer: 'COLLEGE OF PHYSICIANS & SURGEONS PAKISTAN', fileNo: '', product: 'APC 10000VA 230V UPS', total: 554246, status: 'Quotation' },
  { ref: 'S01720', date: '2026-09-07 07:39:46', customer: 'Dunya TV', fileNo: '', product: 'SSD', total: 32155, status: 'Quotation' },
  { ref: 'S01719', date: '2026-09-07 07:38:08', customer: 'TTi Labs', fileNo: '', product: 'APC', total: 1475000, status: 'Quotation' },
  { ref: 'S01718', date: '2026-09-07 07:34:28', customer: 'CYBER INTERNET SERVICES (PRIVATE) LIMITED', fileNo: '', product: 'Fortigate 200F', total: 2330020, status: 'Quotation' },
  { ref: 'S01717', date: '2026-09-04 13:00:56', customer: 'ENGRO POLYMER & CHEMICALS LIMITED', fileNo: '1015 Green', product: 'LAPTOP, ThinkBook,G8', total: 16709000, status: 'Sales Order' },
  { ref: 'S01716', date: '2026-09-04 12:59:59', customer: 'AGA KHAN DEVELOPMENT NETWORK', fileNo: '', product: 'HP OmniBook X Flip', total: 1650000, status: 'Quotation' },
  { ref: 'S01715', date: '2026-09-04 12:58:54', customer: 'PUNJAB GROUP OF COLLEGES LIMITED', fileNo: '', product: 'DDR4 RAM 64 GB', total: 1200000, status: 'Quotation' },
  { ref: 'S01714', date: '2026-09-04 12:57:29', customer: 'TPL CORP LIMITED', fileNo: '', product: 'Hard Drive', total: 221250, status: 'Quotation' },
  { ref: 'S01713', date: '2026-09-04 12:56:01', customer: 'PAKO COMPUTERS', fileNo: '', product: 'PowerEdge R770', total: 7000000, status: 'Quotation' },
  { ref: 'S01712', date: '2026-09-04 09:45:51', customer: 'ORIENT ENERGY SYSTEMS (PRIVATE) LIMITED', fileNo: '', product: 'FortiGate-60F', total: 420000, status: 'Quotation' },
  { ref: 'S01710', date: '2026-09-04 09:44:02', customer: 'AGA KHAN DEVELOPMENT NETWORK', fileNo: '', product: 'HP Probook 440 G11', total: 1271600, status: 'Quotation' },
  { ref: 'S01709', date: '2026-09-04 06:50:02', customer: 'NATIONAL ENGINEERING AND SCIENTIFIC COMMISSION', fileNo: '1014 Blue', product: 'Dell Poweredge R760', total: 18000000, status: 'Sales Order' },
  { ref: 'S01708', date: '2026-09-03 13:00:40', customer: 'INFORMATION SYSTEMS ASSOCIATES LIMITED', fileNo: '', product: 'FortiGate-60F', total: 420000, status: 'Quotation' },
  { ref: 'S01707', date: '2026-09-03 10:48:30', customer: 'FAUJI CEMENT COMPANY LIMITED', fileNo: '', product: 'TrendMicro EPP+ EDR Software', total: 8706075, status: 'Quotation' },
  { ref: 'S01706', date: '2026-09-03 10:47:09', customer: 'THE INSTITUTE OF CHARTERED ACCOUNTANTS OF PAKISTAN', fileNo: '', product: 'Toner', total: 70033, status: 'Quotation' },
  { ref: 'S01705', date: '2026-09-03 10:45:03', customer: 'HISPAR NETWORKS (PRIVATE) LIMITED', fileNo: '', product: 'HP Printers', total: 676480, status: 'Quotation' },
  { ref: 'S01704', date: '2026-09-03 07:19:49', customer: 'IQRA UNIVERSITY', fileNo: '', product: 'TP-Link', total: 55224, status: 'Quotation' },
  { ref: 'S01703', date: '2026-09-03 07:18:34', customer: 'IQRA UNIVERSITY', fileNo: '', product: 'SFP Module', total: 1180000, status: 'Quotation' },
  { ref: 'S01702', date: '2026-09-03 07:12:49', customer: '1LINK (PRIVATE) LIMITED', fileNo: '', product: 'PowerEdge R760XS', total: 5250000, status: 'Quotation' },
  { ref: 'S01701', date: '2026-09-02 11:59:22', customer: 'X-Mart Technology', fileNo: '', product: 'BDCOM S2500-8T2S', total: 25700, status: 'Quotation' },
  { ref: 'S01700', date: '2026-09-02 11:25:35', customer: 'ENGRO FERTILIZERS LIMITED', fileNo: '1013 Blue', product: 'SOFTWARE, LICENSE, CEBCDE-AAAA', total: 145464, status: 'Sales Order' },
  { ref: 'S01699', date: '2026-09-02 11:01:59', customer: 'SILICON ENTERPRISE SOLUTIONS (PRIVATE) LIMITED', fileNo: '', product: 'PowerEdge R470', total: 4750000, status: 'Quotation' },
  { ref: 'S01698', date: '2026-09-02 07:13:46', customer: 'ENGLISH BISCUIT MANUFACTURERS (PRIVATE) LIMITED', fileNo: '', product: 'Samsung Galaxy Tab Active5 Pro 5G', total: 3068000, status: 'Quotation' },
  { ref: 'S01697', date: '2026-09-02 07:12:46', customer: 'INFOTECH (PRIVATE) LIMITED', fileNo: '', product: 'HP Laser Jet Printer', total: 588289, status: 'Quotation' },
  { ref: 'S01696', date: '2026-09-02 07:10:22', customer: 'PUNJAB GROUP OF COLLEGES LIMITED', fileNo: '', product: 'PowerEdge R760XS', total: 6100000, status: 'Quotation' },
  { ref: 'S01695', date: '2026-09-02 07:08:18', customer: 'MUGHAL IRON AND STEEL INDUSTRIES LIMITED', fileNo: '', product: 'Hdd Connector', total: 90801, status: 'Quotation' },
  { ref: 'S01675', date: '2026-08-31 10:48:16', customer: 'MEKOTEX (PRIVATE) LIMITED', fileNo: '1012 Green', product: 'FORTIGATE FIREWALL 101F LICENSE RENEWAL', total: 509162, status: 'Sales Order' },
  { ref: 'S01694', date: '2026-09-01 12:52:19', customer: 'MEEZAN BANK LIMITED', fileNo: '', product: 'HP Color LaserJet Pro', total: 193520, status: 'Quotation' },
  { ref: 'S01693', date: '2026-09-01 12:18:11', customer: 'MEKOTEX (PRIVATE) LIMITED', fileNo: '', product: 'Synology & Seagate 10TB', total: 3801960, status: 'Quotation' },
  { ref: 'S01692', date: '2026-09-01 07:52:39', customer: 'PRESTIGE GENERAL TRADING PVT. LIMITED', fileNo: '', product: 'HPE ProLiant DL380 Gen11 8SFF NC Configure-to-order Server', total: 22500000, status: 'Quotation' },

  // Page 2
  { ref: 'S01691', date: '2026-09-01 07:49:56', customer: 'ENGENTRA ( SMC-PRIVATE ) LIMITED', fileNo: '', product: '6-Hour UPS Backup Proposal', total: 720567, status: 'Quotation' },
  { ref: 'S01690', date: '2026-09-01 07:48:37', customer: 'ASTERA SOFTWARE PAKISTAN (PVT. ) LIMITED', fileNo: '', product: 'FortiGate-60F', total: 402500, status: 'Quotation' },
  { ref: 'S01689', date: '2026-09-01 07:47:49', customer: 'PUNJAB GROUP OF COLLEGES LIMITED', fileNo: '', product: 'H755 Raid Controller 12gbps', total: 619500, status: 'Quotation' },
  { ref: 'S01688', date: '2026-09-01 07:45:46', customer: 'SILICON ENTERPRISE SOLUTIONS (PRIVATE) LIMITED', fileNo: '', product: 'PowerEdge R760XS', total: 4150000, status: 'Quotation' },
  { ref: 'S01687', date: '2026-08-31 12:58:26', customer: 'INDUS HOSPITAL & HEALTH NETWORK', fileNo: '', product: 'Lenovo ThinkBook 14 Gen 9', total: 1560000, status: 'Quotation' },
  { ref: 'S01686', date: '2026-08-31 12:56:47', customer: 'ASTERA SOFTWARE PAKISTAN (PVT. ) LIMITED', fileNo: '', product: 'Dell Optiplex Tower (Plus 7020)', total: 1463000, status: 'Quotation' },
  { ref: 'S01685', date: '2026-08-31 12:55:25', customer: 'INDUS HOSPITAL & HEALTH NETWORK', fileNo: '', product: 'Lenovo ThinkBook 14 Gen 9', total: 690000, status: 'Quotation' },
  { ref: 'S01684', date: '2026-08-31 12:53:51', customer: 'ENGENTRA ( SMC-PRIVATE ) LIMITED', fileNo: '', product: 'PowerEdge R760XS', total: 4750000, status: 'Quotation' },
  { ref: 'S01683', date: '2026-08-31 11:04:45', customer: 'AIRBLUE LIMITED', fileNo: '', product: 'HP Laptop 15', total: 2849000, status: 'Quotation' },
  { ref: 'S01682', date: '2026-08-31 11:03:27', customer: 'AIRBLUE LIMITED', fileNo: '', product: 'HP PROBOOK 4 G1', total: 2937000, status: 'Quotation' },
  { ref: 'S01680', date: '2026-08-31 10:56:01', customer: 'CYBER INTERNET SERVICES (PRIVATE) LIMITED', fileNo: '', product: '71G & 51G Bundle', total: 1609048, status: 'Quotation' },
  { ref: 'S01679', date: '2026-08-31 10:54:52', customer: 'NISHAT HOTEL AND PROPERTIES LTD', fileNo: '', product: 'Dell Pro Tower QCT1250', total: 329560, status: 'Quotation' },
  { ref: 'S01678', date: '2026-08-31 10:53:16', customer: 'MOBISERVE PAKISTAN (PVT.) LIMITED', fileNo: '', product: 'Dell PowerEdge R760xs Server', total: 5900000, status: 'Quotation' },
  { ref: 'S01677', date: '2026-08-31 10:51:17', customer: 'NDS COMPUTER SYSTEMS (PRIVATE) LIMITED', fileNo: '', product: 'PowerEdge R760', total: 6250000, status: 'Quotation' },
  { ref: 'S01676', date: '2026-08-31 10:49:58', customer: 'NDS COMPUTER SYSTEMS (PRIVATE) LIMITED', fileNo: '', product: 'PowerEdge R760XS', total: 7000000, status: 'Quotation' },
  { ref: 'S01674', date: '2026-08-31 10:46:47', customer: 'GCS (PRIVATE) LIMITED', fileNo: '', product: 'PowerEdge R760XS', total: 7500000, status: 'Quotation' },
  { ref: 'S01673', date: '2026-08-28 10:11:19', customer: 'AGA KHAN DEVELOPMENT NETWORK', fileNo: '', product: 'Lenovo L24-4e Monitor', total: 56640, status: 'Quotation' },
  { ref: 'S01672', date: '2026-08-28 10:08:00', customer: 'OLP MODARABA', fileNo: '', product: 'MDaemon Email Solution', total: 2212140, status: 'Quotation' },
  { ref: 'S01671', date: '2026-08-28 10:06:46', customer: 'DP World - QICT (Qasim International Container Terminal)', fileNo: '', product: 'TP-Link Deco X50', total: 83780, status: 'Quotation' },
  { ref: 'S01670', date: '2026-08-28 07:49:06', customer: 'CYBER INTERNET SERVICES (PRIVATE) LIMITED', fileNo: '', product: '80F Renewal', total: 386540, status: 'Quotation' },
  { ref: 'S01669', date: '2026-08-28 07:47:42', customer: 'IT NETWORK', fileNo: '', product: 'PowerEdge R760XS', total: 7250000, status: 'Quotation' },
  { ref: 'S01668', date: '2026-08-28 07:46:21', customer: 'GENIX PHARMA (PRIVATE) LIMITED', fileNo: '', product: 'D-Link Wireless AX Wi-Fi', total: 502680, status: 'Quotation' },
  { ref: 'S01667', date: '2026-08-28 07:22:21', customer: 'IT NETWORK', fileNo: '', product: 'PowerEdge T160', total: 2150000, status: 'Quotation' },
  { ref: 'S01666', date: '2026-08-28 07:09:12', customer: 'INDUS HOSPITAL & HEALTH NETWORK', fileNo: '', product: 'Unbraded Desktop', total: 4330000, status: 'Quotation' },
  { ref: 'S01665', date: '2026-08-27 13:01:15', customer: 'NISHAT HOTEL AND PROPERTIES LTD', fileNo: '', product: 'HP 15-FD1134NIA', total: 202950, status: 'Quotation' },
  { ref: 'S01664', date: '2026-08-27 12:57:43', customer: 'AIRBLUE LIMITED', fileNo: '', product: 'HP OmniBook X', total: 462000, status: 'Quotation' },
  { ref: 'S01663', date: '2026-08-27 12:56:30', customer: 'IT NETWORK', fileNo: '', product: 'Synology RS2825RP+ NAS, HDDs, and Railkit', total: 12387200, status: 'Quotation' },
  { ref: 'S01662', date: '2026-08-27 12:12:58', customer: 'NATIONAL PETROCARBON (PRIVATE) LIMITED', fileNo: '1011 Green', product: 'Fortigate 40F Bundle', total: 194700, status: 'Sales Order' },
  { ref: 'S01661', date: '2026-08-27 11:07:15', customer: 'ENGRO ENFRASHARE ( PRIVATE ) LIMITED', fileNo: '1010 Green', product: 'Laptop, ThinkPad, E16, G3', total: 14961408, status: 'Sales Order' },
  { ref: 'S01660', date: '2026-08-27 09:11:08', customer: 'Masood Textile Mills Limited', fileNo: '', product: 'PowerEdge R760XS', total: 9000000, status: 'Quotation' },
  { ref: 'S01659', date: '2026-08-27 09:08:27', customer: 'Masood Textile Mills Limited', fileNo: '', product: 'Dell Pro 16 PC16250 8Gb / 16Gb', total: 2772000, status: 'Quotation' },
  { ref: 'S01658', date: '2026-08-27 09:05:22', customer: 'TIME & TUNE', fileNo: '', product: 'R750 Dell Server', total: 5000000, status: 'Quotation' },
  { ref: 'S01657', date: '2026-08-27 09:03:44', customer: 'DADEX ETERNIT LIMITED', fileNo: '', product: 'VERTIV UPS', total: 17110, status: 'Quotation' },

  // Page 3
  { ref: 'S01566', date: '2026-08-07 12:06:45', customer: 'INDUS HOSPITAL & HEALTH NETWORK', fileNo: '1009 Green', product: 'HP Scanner', total: 193000, status: 'Sales Order' },
  { ref: 'S01656', date: '2026-08-25 12:24:28', customer: 'GCS (PRIVATE) LIMITED', fileNo: '', product: 'BDCOM', total: 333940, status: 'Quotation' },
  { ref: 'S01655', date: '2026-08-25 12:21:33', customer: 'IT NETWORK', fileNo: '', product: 'Synology', total: 1564000, status: 'Quotation' },
  { ref: 'S01654', date: '2026-08-25 12:19:12', customer: 'INTERNATIONAL OFFICE PRODUCTS (PRIVATE) LIMITED', fileNo: '', product: 'PowerEdge R760XS', total: 7250000, status: 'Quotation' },
  { ref: 'S01641', date: '2026-08-25 07:03:50', customer: 'AIRBLUE LIMITED', fileNo: '1008 Green', product: 'Toten G3 Rack', total: 175000, status: 'Sales Order' },
  { ref: 'S01653', date: '2026-08-25 11:32:54', customer: 'NATIONAL ENGINEERING AND SCIENTIFIC COMMISSION', fileNo: '1007 Green', product: 'External Blue Ray USB-Disc', total: 359900, status: 'Sales Order' },
  { ref: 'S01652', date: '2026-08-25 08:07:12', customer: 'ENGRO POWERGEN THAR ( PVT. ) LIMITED', fileNo: '1006 Green', product: 'Laptop, ThinkPad, E16, G3', total: 453376, status: 'Sales Order' },
  { ref: 'S01592', date: '2026-08-12 07:34:18', customer: 'AL MEHMOOD GROUP', fileNo: '1005 Green', product: 'PROBOOK 440 G11 ULTRA7 155U, 16GB', total: 430650, status: 'Sales Order' },
  { ref: 'S01651', date: '2026-08-25 07:50:25', customer: 'ENGRO FERTILIZERS LIMITED', fileNo: '1004 Green', product: 'Laptop, ThinkPad, E16, G3', total: 453376, status: 'Sales Order' },
  { ref: 'S01649', date: '2026-08-25 07:33:42', customer: 'ENGRO CORPORATION LIMITED', fileNo: '1001 Green', product: 'Laptop, ThinkPad, E16, G3', total: 2720256, status: 'Sales Order' },
  { ref: 'S01650', date: '2026-08-25 07:40:10', customer: 'COMPUTER CONCERN', fileNo: '1003 Green', product: 'BDCOM', total: 214500, status: 'Sales Order' },
  { ref: 'S01340', date: '2026-07-07 05:35:25', customer: 'INDUS HOSPITAL & HEALTH NETWORK', fileNo: '1002 Green', product: 'HP Victus Notebook', total: 914000, status: 'Sales Order' },
  { ref: 'S01648', date: '2026-08-25 07:24:14', customer: 'Masood Textile Mills Limited', fileNo: '', product: 'PowerEdge R760XS', total: 9000000, status: 'Quotation' },
  { ref: 'S01647', date: '2026-08-25 07:22:29', customer: 'SILICON ENTERPRISE SOLUTIONS (PRIVATE) LIMITED', fileNo: '', product: 'PowerEdge R770', total: 25000000, status: 'Quotation' },
  { ref: 'S01646', date: '2026-08-25 07:18:30', customer: "GERRY'S DNATA PVT. LTD.", fileNo: '', product: 'Acrobat Pro for Teams', total: 632500, status: 'Quotation' },
  { ref: 'S01645', date: '2026-08-25 07:17:21', customer: 'Premier Star Technology (Private) Limited', fileNo: '', product: 'FortiGate-200F Bundle', total: 1926000, status: 'Quotation' },
  { ref: 'S01644', date: '2026-08-25 07:16:26', customer: 'STYLE TEXTILE (PVT) LIMITED', fileNo: '', product: '1100w power supply', total: 94400, status: 'Quotation' },
  { ref: 'S01643', date: '2026-08-25 07:12:38', customer: 'NDS COMPUTER SYSTEMS (PRIVATE) LIMITED', fileNo: '', product: 'PowerEdge R760XS', total: 26250000, status: 'Quotation' },
  { ref: 'S01642', date: '2026-08-25 07:09:38', customer: 'GCS (PRIVATE) LIMITED', fileNo: '', product: 'PowerEdge R760XS', total: 4750000, status: 'Quotation' },
  { ref: 'S01640', date: '2026-08-25 07:01:57', customer: 'UNITED MARINE AGENCIES PVT LTD', fileNo: '', product: 'Adobe renewal', total: 342700, status: 'Quotation' },
  { ref: 'S01639', date: '2026-08-25 06:58:26', customer: 'MSM TECHNOLOGY', fileNo: '', product: 'PowerEdge R760XS', total: 8500000, status: 'Quotation' },
  { ref: 'S01638', date: '2026-08-25 06:54:59', customer: '1LINK (PRIVATE) LIMITED', fileNo: '', product: 'PowerEdge R360', total: 3000000, status: 'Quotation' },
  { ref: 'S01637', date: '2026-08-25 06:52:19', customer: 'AMRELI STEELS LIMITED', fileNo: '', product: 'Dell Pro 14 PC14250', total: 341000, status: 'Quotation' },
  { ref: 'S01636', date: '2026-08-25 06:50:23', customer: 'PAKO COMPUTERS', fileNo: '', product: 'PowerEdge R760XS', total: 6650000, status: 'Quotation' },
  { ref: 'S01635', date: '2026-08-25 06:45:23', customer: 'INDUS HOSPITAL & HEALTH NETWORK', fileNo: '', product: 'Office 365 E1', total: 53760000, status: 'Quotation' },
  { ref: 'S01634', date: '2026-08-25 06:43:57', customer: 'Masood Textile Mills Limited', fileNo: '', product: 'Dell Pro 16 PC16250', total: 1430000, status: 'Quotation' },
  { ref: 'S01633', date: '2026-08-25 06:41:26', customer: "GERRY'S DNATA PVT. LTD.", fileNo: '', product: 'PowerEdge R760', total: 6250000, status: 'Quotation' },
  { ref: 'S01632', date: '2026-08-25 06:39:11', customer: 'CNERGYICO PK LIMITED', fileNo: '', product: 'HP PROBOOK 4 G1i 16', total: 1159950, status: 'Quotation' },
  { ref: 'S01631', date: '2026-08-25 06:36:51', customer: 'IMTIAZ GROUP (PRIVATE) LIMITED', fileNo: '', product: 'HP Laptop 15', total: 18870500, status: 'Quotation' },
  { ref: 'S01630', date: '2026-08-25 06:25:15', customer: 'MEZAN BEVERAGES (PVT.) LIMITED', fileNo: '', product: 'HP & Dell Laptop', total: 700150, status: 'Quotation' },
  { ref: 'S01629', date: '2026-08-25 06:23:14', customer: 'INTERNATIONAL OFFICE PRODUCTS (PRIVATE) LIMITED', fileNo: '', product: 'APC Smart-UPS X, 1000 VA', total: 156600, status: 'Quotation' },
  { ref: 'S01628', date: '2026-08-25 06:21:42', customer: "GERRY'S DNATA PVT. LTD.", fileNo: '', product: 'HP LASERJET PRO', total: 210040, status: 'Quotation' },
  { ref: 'S01627', date: '2026-08-25 06:17:33', customer: 'THE AUTOMATORS PVT. LTD.', fileNo: '', product: 'PowerEdge T560', total: 2900000, status: 'Quotation' },
  { ref: 'S01626', date: '2026-08-25 06:15:22', customer: 'Dunya TV', fileNo: '', product: 'HP Toner 26-A', total: 53100, status: 'Quotation' },
  { ref: 'S01625', date: '2026-08-25 06:13:50', customer: 'SUI SOUTHERN GAS COMPANY LIMITED', fileNo: '', product: 'Fortinet 60F', total: 109250, status: 'Quotation' },
  { ref: 'S01624', date: '2026-08-25 06:11:44', customer: 'AL MEHMOOD GROUP', fileNo: '', product: 'LENOVO YOGA 7', total: 341550, status: 'Quotation' },
  { ref: 'S01623', date: '2026-08-25 06:09:45', customer: 'AL MEHMOOD GROUP', fileNo: '', product: 'HP PROBOOK 4', total: 392150, status: 'Quotation' },

  // Page 4
  { ref: 'S01622', date: '2026-08-25 06:07:50', customer: 'INFORMATION SYSTEMS ASSOCIATES LIMITED', fileNo: '', product: 'PowerEdge T560', total: 3000000, status: 'Quotation' },
  { ref: 'S01621', date: '2026-08-25 06:02:31', customer: 'ENGRO FERTILIZERS LIMITED', fileNo: '', product: 'FortiGate-400F 1 Year', total: 5531960, status: 'Quotation' },
  { ref: 'S01620', date: '2026-08-25 06:00:45', customer: 'NATIONAL CLEARING COMPANY OF PAKISTAN LIMITED', fileNo: '', product: 'HP Scanner-3Y', total: 200010, status: 'Quotation' },
  { ref: 'S01619', date: '2026-08-25 05:59:31', customer: 'NISHAT HOTEL AND PROPERTIES LTD', fileNo: '', product: 'Lenovo Thinkpad E14 Gen 7', total: 437580, status: 'Quotation' },
  { ref: 'S01618', date: '2026-08-25 05:56:33', customer: 'CISLINK TECHNOLOGY', fileNo: '', product: 'APC Easy UPS 10kVA (SRV10KI)', total: 1250000, status: 'Quotation' },
  { ref: 'S01617', date: '2026-08-25 05:55:18', customer: 'BKF ENTERPRISES ( PRIVATE ) LIMITED', fileNo: '', product: 'Fortinet FortiGate 200G (1Year)', total: 2588000, status: 'Quotation' },
  { ref: 'S01616', date: '2026-08-25 05:50:07', customer: 'BIAFO INDUSTRIES LIMITED', fileNo: '', product: 'HP LASERJET Printer', total: 218300, status: 'Quotation' },
  { ref: 'S01615', date: '2026-08-25 05:46:49', customer: 'RIPHAH INTERNATIONAL UNIVERSITY', fileNo: '', product: 'PowerEdge R760XS', total: 9100000, status: 'Quotation' },
  { ref: 'S01613', date: '2026-08-17 09:17:52', customer: 'INFORMATION SYSTEMS ASSOCIATES LIMITED', fileNo: '', product: 'APC Easy UPS', total: 120000, status: 'Quotation' },
  { ref: 'S01612', date: '2026-08-17 09:14:35', customer: 'INTERNATIONAL OFFICE PRODUCTS (PRIVATE) LIMITED', fileNo: '', product: 'PowerEdge R570', total: 6450000, status: 'Quotation' },
  { ref: 'S01611', date: '2026-08-17 09:12:27', customer: 'Futureage Computers', fileNo: '', product: 'PowerEdge R760XS', total: 3750000, status: 'Quotation' },
  { ref: 'S01610', date: '2026-08-17 09:09:23', customer: 'IT NETWORK', fileNo: '', product: 'PowerEdge R770', total: 13000000, status: 'Quotation' },
  { ref: 'S01609', date: '2026-08-17 09:07:31', customer: 'TECHNO VIBES', fileNo: '', product: 'PowerEdge R770', total: 5000000, status: 'Quotation' },
  { ref: 'S01608', date: '2026-08-17 09:05:25', customer: 'PAKO COMPUTERS', fileNo: '', product: 'PowerEdge R760XS', total: 4500000, status: 'Quotation' },
  { ref: 'S01607', date: '2026-08-17 08:58:59', customer: 'PAKISTAN SERVICES LIMITED', fileNo: '1000 Green', product: 'UPS 6KVA', total: 560500, status: 'Sales Order' },
  { ref: 'S01543', date: '2026-08-06 06:07:24', customer: 'INDUS HOSPITAL & HEALTH NETWORK', fileNo: '999 Green', product: 'HP Victus Notebook', total: 457000, status: 'Sales Order' },
  { ref: 'S01605', date: '2026-08-13 12:56:37', customer: 'MEEZAN BANK LIMITED', fileNo: '', product: 'HP Color Printer', total: 206500, status: 'Quotation' },
  { ref: 'S01604', date: '2026-08-13 12:11:13', customer: 'SILICON ENTERPRISE SOLUTIONS (PRIVATE) LIMITED', fileNo: '', product: 'APC Easy UPS', total: 120000, status: 'Quotation' },
  { ref: 'S01603', date: '2026-08-13 12:05:59', customer: 'CYBER INTERNET SERVICES (PRIVATE) LIMITED', fileNo: '997 Green', product: '2TB NLSAS Server Hard Drive', total: 39530, status: 'Sales Order' },
  { ref: 'S01602', date: '2026-08-13 09:00:51', customer: 'CYBER INTERNET SERVICES (PRIVATE) LIMITED', fileNo: '', product: 'S2528-P', total: 192340, status: 'Quotation' },
  { ref: 'S01601', date: '2026-08-13 06:21:42', customer: 'NISHAT HOTEL AND PROPERTIES LTD', fileNo: '', product: 'HP 250 G10 Laptop', total: 190850, status: 'Quotation' },
  { ref: 'S01600', date: '2026-08-13 06:20:38', customer: 'NERA TELECOMMUNICATIONS (PAKISTAN) (PVT.) LIMITED', fileNo: '', product: 'Dell PowerEdge R750 (NEW)', total: 3000000, status: 'Quotation' },
  { ref: 'S01599', date: '2026-08-13 06:18:13', customer: 'NISHAT HOTEL AND PROPERTIES LTD', fileNo: '', product: 'LENOVO THINKPAD E14 G7', total: 402380, status: 'Quotation' },
  { ref: 'S01598', date: '2026-08-13 06:16:33', customer: 'AL MEHMOOD GROUP', fileNo: '', product: 'HP EliteBook 640 G11', total: 413050, status: 'Quotation' },
  { ref: 'S01597', date: '2026-08-13 06:15:23', customer: 'Abc Network (Pvt) Ltd.', fileNo: '', product: 'PowerEdge R760XS B2B', total: 19643040, status: 'Quotation' },
  { ref: 'S01596', date: '2026-08-13 06:14:31', customer: 'Abc Network (Pvt) Ltd.', fileNo: '', product: 'PowerEdge R760XS SNS', total: 5500000, status: 'Quotation' },
  { ref: 'S01595', date: '2026-08-13 06:12:25', customer: 'PAKO COMPUTERS', fileNo: '', product: 'PowerEdge R760XS SNS', total: 5250000, status: 'Quotation' },
  { ref: 'S01593', date: '2026-08-12 07:51:21', customer: 'PAKO COMPUTERS', fileNo: '', product: 'PowerEdge R760XS B2B', total: 13961050, status: 'Quotation' },
  { ref: 'S01591', date: '2026-08-12 07:33:41', customer: 'AL MEHMOOD GROUP', fileNo: '', product: 'PROBOOK 440 G11 ULTRA7 155U, 8GB', total: 392150, status: 'Quotation' },
  { ref: 'S01590', date: '2026-08-12 07:31:28', customer: 'THE INSTITUTE OF CHARTERED ACCOUNTANTS OF PAKISTAN', fileNo: '', product: 'Toner', total: 78706, status: 'Quotation' },
  { ref: 'S01589', date: '2026-08-12 07:28:34', customer: 'LUCKY ELECTRIC POWER COMPANY LIMITED', fileNo: '', product: 'PowerEdge R760XS B2B', total: 13961050, status: 'Quotation' },
  { ref: 'S01588', date: '2026-08-12 07:27:33', customer: 'LUCKY ELECTRIC POWER COMPANY LIMITED', fileNo: '', product: 'PowerEdge R760XS SNS', total: 5250000, status: 'Quotation' },
  { ref: 'S01587', date: '2026-08-12 07:11:03', customer: 'IT NETWORK', fileNo: '', product: 'PowerEdge R760XS B2B', total: 34356920, status: 'Quotation' },
  { ref: 'S01586', date: '2026-08-12 07:08:47', customer: 'IT NETWORK', fileNo: '', product: 'PowerEdge R760XS SNS', total: 7500000, status: 'Quotation' },
  { ref: 'S01585', date: '2026-08-12 07:04:33', customer: 'IT NETWORK', fileNo: '', product: 'PowerEdge R760 B2B', total: 20144490, status: 'Quotation' },

  // Page 5
  { ref: 'S01584', date: '2026-08-12 07:03:09', customer: 'IT NETWORK', fileNo: '', product: 'PowerEdge R760 SNS', total: 6500000, status: 'Quotation' },
  { ref: 'S01583', date: '2026-08-12 07:02:08', customer: 'MEEZAN BANK LIMITED', fileNo: '', product: 'HP Scanjet Pro N4600', total: 258420, status: 'Quotation' },
  { ref: 'S01582', date: '2026-08-12 06:51:30', customer: 'SILICON ENTERPRISE SOLUTIONS (PRIVATE) LIMITED', fileNo: '', product: 'KVM Switch', total: 8259786, status: 'Quotation' },
  { ref: 'S01581', date: '2026-08-12 06:50:36', customer: 'SILICON ENTERPRISE SOLUTIONS (PRIVATE) LIMITED', fileNo: '', product: 'Dell Server B2B', total: 19053445, status: 'Quotation' },
  { ref: 'S01580', date: '2026-08-12 06:48:57', customer: 'SILICON ENTERPRISE SOLUTIONS (PRIVATE) LIMITED', fileNo: '', product: 'Dell Server SNS', total: 9500000, status: 'Quotation' },
  { ref: 'S01579', date: '2026-08-12 06:47:53', customer: 'INTERNATIONAL OFFICE PRODUCTS (PRIVATE) LIMITED', fileNo: '', product: 'Cisco CBS350-16T-2G & C1200-8T-D', total: 222610, status: 'Quotation' },
  { ref: 'S01578', date: '2026-08-12 06:46:57', customer: 'ENGRO FERTILIZERS LIMITED', fileNo: '', product: 'HP OmniBook Ultra Flip Laptop', total: 594000, status: 'Quotation' },
  { ref: 'S01577', date: '2026-08-12 06:45:21', customer: 'GCS (PRIVATE) LIMITED', fileNo: '', product: 'FortiGate-70F Firewall', total: 3115200, status: 'Quotation' },
  { ref: 'S01576', date: '2026-08-12 06:43:21', customer: 'DOLMEN REAL ESTATE MANAGEMENT (PVT.) LIMETED', fileNo: '', product: 'FortiGate-200G', total: 6459320, status: 'Quotation' },
  { ref: 'S01575', date: '2026-08-12 06:40:25', customer: 'SOLUTIONS ARCHITECT', fileNo: '', product: 'Synology NAS Storage', total: 2064250, status: 'Quotation' },
  { ref: 'S01574', date: '2026-08-12 06:36:54', customer: 'CUBE XS WEATHERLY (PRIVATE) LIMITED', fileNo: '', product: 'FortiGate Hardware and FortiGate-40F 1-Year', total: 261750, status: 'Quotation' },
  { ref: 'S01573', date: '2026-08-12 06:30:31', customer: 'ECONCEPTIONS', fileNo: '', product: 'PowerEdge R760XS - SNS', total: 2500000, status: 'Quotation' },
  { ref: 'S01572', date: '2026-08-10 09:43:45', customer: 'INTERNATIONAL OFFICE PRODUCTS (PRIVATE) LIMITED', fileNo: '', product: 'FortiGate-40F licensing and FortiGate-80F Hardware bundle', total: 698750, status: 'Quotation' },
  { ref: 'S01571', date: '2026-08-10 09:42:52', customer: 'INDUS HOSPITAL & HEALTH NETWORK', fileNo: '', product: 'HP ProBook 4', total: 395000, status: 'Quotation' },
  { ref: 'S01570', date: '2026-08-10 09:41:35', customer: 'LOTIA SONS ( PRIVATE ) LIMITED', fileNo: '', product: 'FortiGate-70G', total: 167325, status: 'Quotation' },
  { ref: 'S01569', date: '2026-08-10 09:40:06', customer: 'Masood Textile Mills Limited', fileNo: '', product: 'HP PRODESK 400 G9', total: 1097800, status: 'Quotation' },
  { ref: 'S01568', date: '2026-08-07 12:09:33', customer: 'U&I Garments Pvt. Ltd.', fileNo: '', product: 'Lenovo LED', total: 656080, status: 'Quotation' },
  { ref: 'S01567', date: '2026-08-07 12:07:57', customer: 'INDUS HOSPITAL & HEALTH NETWORK', fileNo: '', product: 'Access Point', total: 385000, status: 'Quotation' },
  { ref: 'S01565', date: '2026-08-07 12:05:31', customer: '1LINK (PRIVATE) LIMITED', fileNo: '', product: 'PowerEdge R760XS - B2B', total: 10109695, status: 'Quotation' },
  { ref: 'S01564', date: '2026-08-07 11:58:25', customer: '1LINK (PRIVATE) LIMITED', fileNo: '', product: 'PowerEdge R760XS - SNS', total: 4600000, status: 'Quotation' },
  { ref: 'S01563', date: '2026-08-07 07:59:37', customer: "GERRY'S DNATA PVT. LTD.", fileNo: '', product: 'Toner', total: 126260, status: 'Quotation' },
  { ref: 'S01491', date: '2026-07-28 07:33:39', customer: 'THE INSTITUTE OF CHARTERED ACCOUNTANTS OF PAKISTAN', fileNo: '996 Green', product: 'HP OMEN 16', total: 528000, status: 'Sales Order' },
  { ref: 'S01562', date: '2026-08-07 06:16:40', customer: 'ENGRO POWERGEN QADIRPUR LIMITED', fileNo: '995 Green', product: 'Laptop, ThinkPad, E16, G3', total: 900599, status: 'Sales Order' },
  { ref: 'S01561', date: '2026-08-07 06:14:29', customer: 'HASCOL PETROLEUM LIMITED', fileNo: '', product: 'LENOVO SLIM 7 14', total: 532950, status: 'Quotation' },
  { ref: 'S01560', date: '2026-08-07 06:12:47', customer: 'LOADS LIMITED', fileNo: '', product: 'PowerEdge R760 - B2B', total: 30617810, status: 'Quotation' },
  { ref: 'S01559', date: '2026-08-07 06:11:32', customer: 'LOADS LIMITED', fileNo: '', product: 'PowerEdge R760 - SNS', total: 9500000, status: 'Quotation' },
  { ref: 'S01558', date: '2026-08-07 06:09:21', customer: 'DEFENCE RAYA GOLF & COUNTRY CLUB', fileNo: '', product: 'APC-10KVA UPS', total: 867300, status: 'Quotation' },
  { ref: 'S01557', date: '2026-08-07 06:08:34', customer: 'NBP FUND MANAGEMENT LIMITED', fileNo: '', product: 'Dell Tower ECT1250', total: 259050, status: 'Quotation' },
  { ref: 'S01556', date: '2026-08-07 06:07:41', customer: 'U&I Garments Pvt. Ltd.', fileNo: '', product: 'Lenovo ThinkBook 16 G8', total: 457600, status: 'Quotation' },
  { ref: 'S01555', date: '2026-08-07 06:06:05', customer: 'Futureage Computers', fileNo: '', product: 'FortiGate-201G', total: 4423000, status: 'Quotation' },
  { ref: 'S01554', date: '2026-08-07 06:04:17', customer: 'REDTONE TELECOMMUNICATIONS PAKISTAN (PVT.) LIMITED', fileNo: '', product: '80F and 100F License / 1 and 3 year', total: 4617250, status: 'Quotation' },
  { ref: 'S01553', date: '2026-08-06 11:43:08', customer: 'WISE TECH SERVICES', fileNo: '994 Green', product: 'Fortinet 40F', total: 122000, status: 'Sales Order' },
  { ref: 'S01552', date: '2026-08-06 10:00:42', customer: 'AIRBLUE LIMITED', fileNo: '', product: 'HP PROBOOK 460 G11', total: 3685000, status: 'Quotation' },
  { ref: 'S01551', date: '2026-08-06 09:59:47', customer: 'NISHAT HOTEL AND PROPERTIES LTD', fileNo: '', product: 'RAM', total: 354000, status: 'Quotation' },
  { ref: 'S01550', date: '2026-08-06 09:57:56', customer: 'TIME & TUNE', fileNo: '', product: 'PowerEdge R760 - B2B', total: 37612345, status: 'Quotation' },
  { ref: 'S01549', date: '2026-08-06 09:56:20', customer: 'TIME & TUNE', fileNo: '', product: 'PowerEdge R760 - SNS', total: 12000000, status: 'Quotation' },
  { ref: 'S01548', date: '2026-08-06 09:55:06', customer: 'AL KARAM TEXTILE MILLS (PRIVATE) LIMITED', fileNo: '', product: 'Toner', total: 102660, status: 'Quotation' },

  // Page 6
  { ref: 'S01547', date: '2026-08-06 09:51:27', customer: "GERRY'S DNATA PVT. LTD.", fileNo: '', product: 'Epson EcoTank', total: 182900, status: 'Quotation' },
  { ref: 'S01546', date: '2026-08-06 09:50:01', customer: 'INTERNATIONAL OFFICE PRODUCTS (PRIVATE) LIMITED', fileNo: '', product: 'PowerEdge T360 - B2B', total: 4081455, status: 'Quotation' },
  { ref: 'S01545', date: '2026-08-06 09:49:28', customer: 'INTERNATIONAL OFFICE PRODUCTS (PRIVATE) LIMITED', fileNo: '', product: 'PowerEdge T360 - SNS', total: 2350000, status: 'Quotation' },
  { ref: 'S01544', date: '2026-08-06 06:16:04', customer: 'VTT PORT QASIM ( PRIVATE ) LIMITED', fileNo: '993 Blue', product: 'HPE MSA 900GB 12G', total: 153400, status: 'Sales Order' },
  { ref: 'S01542', date: '2026-08-06 06:06:32', customer: 'INDUS HOSPITAL & HEALTH NETWORK', fileNo: '', product: 'HP 4003dn Printer', total: 115000, status: 'Quotation' },
  { ref: 'S01541', date: '2026-08-06 06:04:40', customer: 'MEEZAN BANK LIMITED', fileNo: '', product: 'Legion R34w-30 Monitor', total: 135700, status: 'Quotation' },
  { ref: 'S01540', date: '2026-08-06 06:03:02', customer: 'HRA SWITCHGEAR ( PVT ) LTD', fileNo: '', product: '256GB SSD', total: 144000, status: 'Quotation' },
  { ref: 'S01539', date: '2026-08-04 12:48:36', customer: 'Aga Khan Health Service, Pakistan', fileNo: '', product: 'HP PB 440 - 3 Yrs / 1 Yrs', total: 13563000, status: 'Quotation' },
  { ref: 'S01538', date: '2026-08-04 12:46:26', customer: 'HERBION PAKISTAN (PRIVATE) LIMITED', fileNo: '', product: 'FortiGate 121G / 71G', total: 3640300, status: 'Quotation' },
  { ref: 'S01537', date: '2026-08-04 12:44:49', customer: 'ACCRESCENT ENGINEERS PVT LTD', fileNo: '', product: 'Lenovo TB 16 G9 IRL', total: 333300, status: 'Quotation' },
  { ref: 'S01536', date: '2026-08-04 10:19:19', customer: 'U&I Garments Pvt. Ltd.', fileNo: '', product: 'Lenovo V15 G5', total: 3924800, status: 'Quotation' },
  { ref: 'S01535', date: '2026-08-04 10:17:50', customer: 'INDUS HOSPITAL & HEALTH NETWORK', fileNo: '', product: 'HP Probook - 1 Year & 3 Year', total: 10998000, status: 'Quotation' },
  { ref: 'S01534', date: '2026-08-04 10:16:05', customer: 'Fatima Groups', fileNo: '', product: 'HP 400 G9 / DELL OPTIPLEX 7020 i7', total: 836244, status: 'Quotation' },
  { ref: 'S01533', date: '2026-08-04 10:11:33', customer: 'NISHAT HOTEL AND PROPERTIES LTD', fileNo: '', product: 'HP PROBOOK 4 G1i 16', total: 370590, status: 'Quotation' },
  { ref: 'S01532', date: '2026-08-04 07:16:11', customer: 'INTERNATIONAL OFFICE PRODUCTS (PRIVATE) LIMITED', fileNo: '', product: 'PowerEdge R570 - B2B', total: 15009340, status: 'Quotation' },
  { ref: 'S01531', date: '2026-08-04 07:14:49', customer: 'TrueFix', fileNo: '', product: 'PowerEdge R470 - B2B', total: 10427370, status: 'Quotation' },
  { ref: 'S01530', date: '2026-08-04 07:13:21', customer: 'TrueFix', fileNo: '', product: 'PowerEdge R470 - SNS', total: 8000000, status: 'Quotation' },
  { ref: 'S01529', date: '2026-08-04 06:28:06', customer: 'APL LOGISTICS PAKISTAN (PRIVATE) LIMITED', fileNo: '', product: 'Access Points and Licenses', total: 1475570, status: 'Quotation' },
  { ref: 'S01528', date: '2026-08-04 06:24:24', customer: 'ASKARI LIFE ASSURANCE COMPANY LIMITED', fileNo: '', product: 'DELL LED 24', total: 57820, status: 'Quotation' },
  { ref: 'S01527', date: '2026-08-04 06:23:06', customer: 'GADOON TEXTILE MILLS LIMITED', fileNo: '', product: 'LEXAR SSD 256GB', total: 619500, status: 'Quotation' },
  { ref: 'S01526', date: '2026-08-04 06:21:57', customer: 'INDEPENDENT MEDIA CORPORATION (PVT.) LIMITED', fileNo: '', product: 'Cartridge', total: 57230, status: 'Quotation' },
  { ref: 'S01525', date: '2026-08-04 06:20:29', customer: 'AGA KHAN DEVELOPMENT NETWORK', fileNo: '', product: 'Lenovo T14 U5/U7, 16GB, 512GB', total: 1234200, status: 'Quotation' },
  { ref: 'S01524', date: '2026-08-04 06:19:02', customer: 'CMA CGM PAKISTAN (PRIVATE) LIMITED', fileNo: '', product: 'Logitech C920 PRO HD Webcam', total: 41300, status: 'Quotation' },
  { ref: 'S01523', date: '2026-08-03 10:38:00', customer: 'MEKOTEX (PRIVATE) LIMITED', fileNo: '', product: 'HP Laptop & Router', total: 251920, status: 'Quotation' },
  { ref: 'S01522', date: '2026-08-03 10:36:41', customer: 'DP World - QICT (Qasim International Container Terminal)', fileNo: '', product: 'Cisco Products', total: 1793600, status: 'Quotation' },
  { ref: 'S01521', date: '2026-08-03 10:34:59', customer: 'IT NETWORK', fileNo: '', product: 'PowerEdge R770 - B2B', total: 36385517, status: 'Quotation' },
  { ref: 'S01520', date: '2026-08-03 10:34:09', customer: 'IT NETWORK', fileNo: '', product: 'PowerEdge R770 - SNS', total: 12500000, status: 'Quotation' },
  { ref: 'S01448', date: '2026-07-21 08:07:44', customer: 'PC HOTEL LAHORE', fileNo: '992 Green', product: 'HP PROBOOK 450 G10', total: 891000, status: 'Sales Order' },
  { ref: 'S01494', date: '2026-07-28 08:05:04', customer: 'ENGRO POLYMER & CHEMICALS LIMITED', fileNo: '', product: 'Laptop, ThinkPad, E16, G3', total: 9067520, status: 'Quotation' },
  { ref: 'S01410', date: '2026-07-15 07:36:44', customer: 'THE INSTITUTE OF CHARTERED ACCOUNTANTS OF PAKISTAN', fileNo: '991 Green', product: 'FortiGate-100F 1 Year Unified Threat Protection', total: 454250, status: 'Sales Order' },
  { ref: 'S01519', date: '2026-08-01 14:10:25', customer: 'InfoCentric Pty Ltd', fileNo: '990 Blue', product: 'Server R770', total: 43424000, status: 'Sales Order' },
  { ref: 'S01518', date: '2026-08-01 14:05:36', customer: 'ENGRO FERTILIZERS LIMITED', fileNo: '989 Blue', product: 'Galaxy Tablet', total: 2094400, status: 'Sales Order' },
  { ref: 'S01517', date: '2026-08-01 14:02:26', customer: 'ENGRO FERTILIZERS LIMITED', fileNo: '988 Green', product: 'Printer & Scanner', total: 1150500, status: 'Sales Order' },
  { ref: 'S01516', date: '2026-08-01 13:59:23', customer: 'INDUS HOSPITAL & HEALTH NETWORK', fileNo: '', product: 'Office 365 E1', total: 63756000, status: 'Quotation' },
  { ref: 'S01515', date: '2026-08-01 13:58:08', customer: 'MCB INVESTMENT MANAGEMENT LIMITED', fileNo: '', product: 'LENOVO ThinkPad E16 Gen 3', total: 450000, status: 'Quotation' },

  // Page 7
  { ref: 'S01514', date: '2026-08-01 13:56:53', customer: 'IT NETWORK', fileNo: '', product: 'PowerEdge R770 - B2B', total: 51902098, status: 'Quotation' },
  { ref: 'S01513', date: '2026-08-01 13:56:05', customer: 'IT NETWORK', fileNo: '', product: 'PowerEdge R770 - SNS', total: 25000000, status: 'Quotation' },
  { ref: 'S01512', date: '2026-08-01 13:51:42', customer: 'MAHEEN TEXTILE MILLS (PRIVATE) LIMITED', fileNo: '', product: 'Dell PowerEdge R750 Rack Server', total: 5546000, status: 'Quotation' },
  { ref: 'S01511', date: '2026-08-01 13:49:01', customer: 'ASTERA SOFTWARE PAKISTAN (PVT. ) LIMITED', fileNo: '', product: 'HP ProBook 4 G1iR 16', total: 1310100, status: 'Quotation' },
  { ref: 'S01510', date: '2026-08-01 13:46:54', customer: 'ASTERA SOFTWARE PAKISTAN (PVT. ) LIMITED', fileNo: '', product: 'HP ProBook 440 G11', total: 2953500, status: 'Quotation' },
  { ref: 'S01509', date: '2026-08-01 13:25:49', customer: 'ASTERA SOFTWARE PAKISTAN (PVT. ) LIMITED', fileNo: '', product: 'Lenovo ThinkPad E16 Gen 3', total: 1574100, status: 'Quotation' },
  { ref: 'S01508', date: '2026-08-01 13:24:02', customer: 'ENGRO CORPORATION LIMITED', fileNo: '', product: 'MobaXterm Professional Edition', total: 106260, status: 'Quotation' },
  { ref: 'S01506', date: '2026-08-01 13:21:17', customer: "GERRY'S DNATA PVT. LTD.", fileNo: '', product: 'FortiGate-100F', total: 1062000, status: 'Quotation' },
  { ref: 'S01505', date: '2026-08-01 13:17:56', customer: 'INFORMATION SYSTEMS ASSOCIATES LIMITED', fileNo: '', product: 'Fortigate License 201F 401F', total: 2892000, status: 'Quotation' },
  { ref: 'S01504', date: '2026-08-01 13:16:37', customer: 'COMPSI PVT LTD', fileNo: '', product: 'Dell 960GB SSD SAS', total: 150000, status: 'Quotation' },
  { ref: 'S01503', date: '2026-08-01 13:05:41', customer: 'Futureage Computers', fileNo: '', product: 'PowerEdge R760XS - B2B', total: 13069465, status: 'Quotation' },
  { ref: 'S01502', date: '2026-08-01 13:04:57', customer: 'Futureage Computers', fileNo: '', product: 'PowerEdge R760XS - SNS', total: 5000000, status: 'Quotation' },
  { ref: 'S01501', date: '2026-08-01 13:03:17', customer: 'INFORMATION SYSTEMS ASSOCIATES LIMITED', fileNo: '', product: 'PowerEdge R760XS - B2B', total: 56783070, status: 'Quotation' },
  { ref: 'S01500', date: '2026-08-01 13:01:25', customer: 'INFORMATION SYSTEMS ASSOCIATES LIMITED', fileNo: '', product: 'PowerEdge R760XS - SNS', total: 15900000, status: 'Quotation' },
  { ref: 'S01499', date: '2026-08-01 12:57:05', customer: 'DESCON ENGINEERING LIMITED', fileNo: '', product: 'HP Printer', total: 238124, status: 'Quotation' },
  { ref: 'S01498', date: '2026-08-01 12:56:15', customer: 'DESCON ENGINEERING LIMITED', fileNo: '', product: 'Dell Pro Tower', total: 1188000, status: 'Quotation' },
  { ref: 'S01497', date: '2026-08-01 12:54:16', customer: 'Meko Fabrics (Pvt) Limited', fileNo: '', product: 'SSD & HDD', total: 186440, status: 'Quotation' },
  { ref: 'S01496', date: '2026-08-01 12:52:55', customer: 'KARACHI HYDROCARBON TERMINAL LIMITED', fileNo: '', product: 'HDD', total: 153400, status: 'Quotation' },
  { ref: 'S01495', date: '2026-08-01 12:50:28', customer: 'INDEPENDENT MEDIA CORPORATION (PVT.) LIMITED', fileNo: '', product: 'Seagate', total: 279660, status: 'Quotation' },
  { ref: 'S01493', date: '2026-07-28 07:36:16', customer: 'GOHAR TEXTILE MILLS (PVT.) LIMITED', fileNo: '', product: 'Dell 960GB SSD SATA', total: 177000, status: 'Quotation' },
  { ref: 'S01492', date: '2026-07-28 07:35:51', customer: 'GOHAR TEXTILE MILLS (PVT.) LIMITED', fileNo: '', product: 'Dell 960GB SSD SAS', total: 182900, status: 'Quotation' },
  { ref: 'S01490', date: '2026-07-28 07:32:29', customer: 'OUTSTART TECH', fileNo: '', product: 'PowerEdge R760XS - B2B', total: 3575335, status: 'Quotation' },
  { ref: 'S01489', date: '2026-07-28 07:30:51', customer: 'OUTSTART TECH', fileNo: '', product: 'PowerEdge R760XS - SNS', total: 2300000, status: 'Quotation' },
  { ref: 'S01488', date: '2026-07-27 10:56:49', customer: 'INDUS HOSPITAL & HEALTH NETWORK', fileNo: '', product: 'HP Scanner', total: 199000, status: 'Quotation' },
  { ref: 'S01487', date: '2026-07-27 10:55:38', customer: 'INTERNATIONAL OFFICE PRODUCTS (PRIVATE) LIMITED', fileNo: '', product: 'PowerEdge R570 - B2B', total: 13748525, status: 'Quotation' },
  { ref: 'S01486', date: '2026-07-27 10:54:41', customer: 'INTERNATIONAL OFFICE PRODUCTS (PRIVATE) LIMITED', fileNo: '', product: 'PowerEdge R570 - SNS', total: 8000000, status: 'Quotation' },
  { ref: 'S01485', date: '2026-07-27 10:52:22', customer: 'THE HUNAR FOUNDATION', fileNo: '', product: 'Dell Precision 7550', total: 145000, status: 'Quotation' },
  { ref: 'S01484', date: '2026-07-27 10:49:56', customer: 'NISHAT HOTEL AND PROPERTIES LTD', fileNo: '', product: 'Dell Pro Tower', total: 502370, status: 'Quotation' },
  { ref: 'S01483', date: '2026-07-27 07:05:41', customer: 'PC HOTEL LAHORE', fileNo: '985 Green', product: 'S1508D BDCOM', total: 19293, status: 'Sales Order' },
  { ref: 'S01482', date: '2026-07-27 06:59:33', customer: 'INDEPENDENT MEDIA CORPORATION (PVT.) LIMITED', fileNo: '', product: 'TRANSCEND 4TB', total: 196000, status: 'Quotation' },
  { ref: 'S01481', date: '2026-07-27 06:58:28', customer: 'INDUS HOSPITAL & HEALTH NETWORK', fileNo: '', product: 'HP ProBook 4 G1iR 16', total: 296000, status: 'Quotation' },
  { ref: 'S01480', date: '2026-07-27 06:50:14', customer: 'INFORMATION SYSTEMS ASSOCIATES LIMITED', fileNo: '', product: 'FG-120G & FG-70G', total: 4232000, status: 'Quotation' },
  { ref: 'S01479', date: '2026-07-27 06:46:33', customer: 'PC HOTEL LAHORE', fileNo: '', product: 'APC', total: 176410, status: 'Quotation' },
  { ref: 'S01478', date: '2026-07-27 06:45:37', customer: 'MEEZAN BANK LIMITED', fileNo: '', product: 'Lenovo ThinkPad E16 Gen 3', total: 588500, status: 'Quotation' },
  { ref: 'S01477', date: '2026-07-27 06:42:56', customer: 'NISHAT HOTEL AND PROPERTIES LTD', fileNo: '', product: 'Licenses', total: 2123625, status: 'Quotation' },

  // Page 8
  { ref: 'S01476', date: '2026-07-24 07:00:35', customer: 'SILICON ENTERPRISE SOLUTIONS (PRIVATE) LIMITED', fileNo: '', product: 'Dell PowerEdge R760xs', total: 2300000, status: 'Quotation' },
  { ref: 'S01475', date: '2026-07-24 06:56:19', customer: 'LUCKY TEXTILE MILLS LIMITED', fileNo: '', product: 'Desktop & SSD', total: 723340, status: 'Quotation' },
  { ref: 'S01474', date: '2026-07-24 06:55:21', customer: 'THE INSTITUTE OF CHARTERED ACCOUNTANTS OF PAKISTAN', fileNo: '', product: 'Toner HP 17A', total: 31270, status: 'Quotation' },
  { ref: 'S01473', date: '2026-07-24 06:54:33', customer: 'BIAFO INDUSTRIES LIMITED', fileNo: '', product: 'HP LJ MFP 4103FDW Printer', total: 206500, status: 'Quotation' },
  { ref: 'S01472', date: '2026-07-24 06:52:09', customer: 'Hotel One', fileNo: '', product: 'Windown License', total: 55342, status: 'Quotation' },
  { ref: 'S01471', date: '2026-07-24 06:50:34', customer: 'INFORMATION SYSTEMS ASSOCIATES LIMITED', fileNo: '', product: 'PowerEdge R360 - B2B', total: 2473265, status: 'Quotation' },
  { ref: 'S01470', date: '2026-07-24 06:49:58', customer: 'INFORMATION SYSTEMS ASSOCIATES LIMITED', fileNo: '', product: 'PowerEdge R360 - SNS', total: 1750000, status: 'Quotation' },
  { ref: 'S01469', date: '2026-07-23 10:38:38', customer: 'ENGRO POLYMER & CHEMICALS LIMITED', fileNo: '984 Green', product: 'Laptop, ThinkPad, E16, G3', total: 9067520, status: 'Sales Order' },
  { ref: 'S01466', date: '2026-07-23 07:52:55', customer: 'NISHAT HOTEL AND PROPERTIES LTD', fileNo: '', product: '960gb 6g Sata 3.5in SSD', total: 483800, status: 'Quotation' },
  { ref: 'S01465', date: '2026-07-23 07:52:02', customer: 'Futureage Computers', fileNo: '', product: 'Dell Server(B2B) and Desktop PCs', total: 62366937, status: 'Quotation' },
  { ref: 'S01464', date: '2026-07-23 07:49:21', customer: 'Futureage Computers', fileNo: '', product: 'Dell Server(SNS) and Desktop PCs', total: 41971880, status: 'Quotation' },
  { ref: 'S01463', date: '2026-07-23 07:48:12', customer: 'AGA KHAN DEVELOPMENT NETWORK', fileNo: '', product: 'HP ProBook 640 G11', total: 500500, status: 'Quotation' },
  { ref: 'S01462', date: '2026-07-23 07:46:03', customer: 'NDS COMPUTER SYSTEMS (PRIVATE) LIMITED', fileNo: '', product: 'PowerEdge R760 - B2B', total: 44765250, status: 'Quotation' },
  { ref: 'S01461', date: '2026-07-23 07:43:44', customer: 'NDS COMPUTER SYSTEMS (PRIVATE) LIMITED', fileNo: '', product: 'PowerEdge R760 - SNS', total: 20000000, status: 'Quotation' },
  { ref: 'S01460', date: '2026-07-22 11:37:52', customer: 'ENGRO CORPORATION LIMITED', fileNo: '983 Blue', product: 'MAINTENANCE OR SUPPORT FEES', total: 11772320, status: 'Sales Order' },
  { ref: 'S01459', date: '2026-07-22 11:35:42', customer: 'PAKISTAN SERVICES LIMITED', fileNo: '982 Blue', product: 'HPE 480GB SATA 6G 2.5-inch SSDs', total: 944000, status: 'Sales Order' },
  { ref: 'S01458', date: '2026-07-22 07:57:54', customer: 'Enterprise Business Machines EBMIT', fileNo: '', product: 'Synology NAS solution', total: 2685000, status: 'Quotation' },
  { ref: 'S01457', date: '2026-07-22 07:53:34', customer: 'ASTERA SOFTWARE PAKISTAN (PVT. ) LIMITED', fileNo: '', product: 'Aruba', total: 1345200, status: 'Quotation' },
  { ref: 'S01456', date: '2026-07-22 07:51:00', customer: 'INTERNATIONAL OFFICE PRODUCTS (PRIVATE) LIMITED', fileNo: '', product: 'Lenovo Monitor', total: 2780000, status: 'Quotation' },
  { ref: 'S01455', date: '2026-07-22 07:47:32', customer: 'PAKISTAN STOCK EXCHANGE LIMITED', fileNo: '', product: 'Caddy', total: 81420, status: 'Quotation' },
  { ref: 'S01454', date: '2026-07-22 07:44:33', customer: 'CRATSOL', fileNo: '', product: 'PowerEdge R760 - B2B', total: 13719202, status: 'Quotation' },
  { ref: 'S01453', date: '2026-07-22 07:43:00', customer: 'CRATSOL', fileNo: '', product: 'PowerEdge R760 - SNS', total: 7700000, status: 'Quotation' },
  { ref: 'S01452', date: '2026-07-21 12:07:30', customer: 'CYBER INTERNET SERVICES (PRIVATE) LIMITED', fileNo: '', product: '120 G Bundle', total: 6013280, status: 'Quotation' },
  { ref: 'S01451', date: '2026-07-21 12:05:31', customer: '4U TRADE AND SERVE', fileNo: '', product: 'FortiGate-100F', total: 395000, status: 'Quotation' },
  { ref: 'S01450', date: '2026-07-21 12:03:09', customer: 'PC HOTEL LAHORE', fileNo: '', product: 'APC', total: 5013110, status: 'Quotation' },
  { ref: 'S01449', date: '2026-07-21 12:00:27', customer: 'ADAMJEE LIFE ASSURANCE COMPANY LIMITED', fileNo: '', product: 'Microsoft 365', total: 2873850, status: 'Quotation' },
  { ref: 'S01447', date: '2026-07-21 08:06:04', customer: 'KOMPASS PAKISTAN (PRIVATE) LIMITED.', fileNo: '', product: 'FortiGate-100F', total: 428950, status: 'Quotation' },
  { ref: 'S01446', date: '2026-07-21 08:05:09', customer: 'InfoCentric Pty Ltd', fileNo: '', product: 'Dell Products', total: 10773000, status: 'Quotation' },
  { ref: 'S01445', date: '2026-07-21 08:03:37', customer: 'Enterprise Business Machines EBMIT', fileNo: '', product: 'PowerEdge R760 - B2B', total: 69065240, status: 'Quotation' },
  { ref: 'S01444', date: '2026-07-21 08:02:17', customer: 'Enterprise Business Machines EBMIT', fileNo: '', product: 'PowerEdge R760 - SNS', total: 25000000, status: 'Quotation' },
  { ref: 'S01443', date: '2026-07-21 07:19:58', customer: 'ENGRO VOPAK TERMINAL LIMITED', fileNo: '981 Green', product: 'Laptop, ThinkPad, E16, G3', total: 453376, status: 'Sales Order' },
  { ref: 'S01442', date: '2026-07-20 12:21:17', customer: 'SHAHEED ZULFIKAR ALI BHUTTO INSTITUTE OF SCIENCE AND TECHNOLOGY', fileNo: '', product: 'Dell Desktop with LED', total: 825000, status: 'Quotation' },
  { ref: 'S01441', date: '2026-07-20 11:29:39', customer: 'AGA KHAN DEVELOPMENT NETWORK', fileNo: '', product: 'HP Printer', total: 138060, status: 'Quotation' },
  { ref: 'S01440', date: '2026-07-20 11:28:37', customer: 'REON ENERGY LIMITED', fileNo: '', product: 'PowerEdge R360 - B2B', total: 2354110, status: 'Quotation' },
  { ref: 'S01439', date: '2026-07-20 11:27:45', customer: 'REON ENERGY LIMITED', fileNo: '', product: 'PowerEdge R360 - SNS', total: 1850000, status: 'Quotation' },

  // Page 9
  { ref: 'S01438', date: '2026-07-20 11:26:23', customer: 'GADOON TEXTILE MILLS LIMITED', fileNo: '', product: 'SAMSUNG SSD 500GB', total: 153400, status: 'Quotation' },
  { ref: 'S01437', date: '2026-07-20 11:25:25', customer: 'PAKO COMPUTERS', fileNo: '', product: 'PowerEdge R750', total: 4000000, status: 'Quotation' },
  { ref: 'S01436', date: '2026-07-20 10:02:13', customer: 'HUTAIB INFOTECH TRADING L.L.C', fileNo: '', product: 'Fortinet Firewall', total: 19152000, status: 'Quotation' },
  { ref: 'S01435', date: '2026-07-20 09:57:11', customer: 'SHAHEED ZULFIKAR ALI BHUTTO INSTITUTE OF SCIENCE AND TECHNOLOGY', fileNo: '', product: 'WD HDD', total: 348100, status: 'Quotation' },
  { ref: 'S01434', date: '2026-07-20 09:56:26', customer: 'INFORMATION SYSTEMS ASSOCIATES LIMITED', fileNo: '', product: 'PowerEdge R770 Server - B2B', total: 42827055, status: 'Quotation' },
  { ref: 'S01433', date: '2026-07-20 09:54:53', customer: 'INFORMATION SYSTEMS ASSOCIATES LIMITED', fileNo: '', product: 'PowerEdge R770 Server - SNS', total: 18500000, status: 'Quotation' },
  { ref: 'S01322', date: '2026-07-03 11:29:47', customer: 'INDUS HOSPITAL & HEALTH NETWORK', fileNo: '980 Green', product: 'HP Scanner', total: 114000, status: 'Sales Order' },
  { ref: 'S01432', date: '2026-07-20 06:42:16', customer: 'ENGRO ENERGY LIMITED', fileNo: '979 Green', product: 'Laptop, ThinkPad, E16, G3', total: 3173632, status: 'Sales Order' },
  { ref: 'S01431', date: '2026-07-20 06:39:02', customer: 'ENGRO POWERGEN THAR ( PVT. ) LIMITED', fileNo: '977 Green', product: 'Laptop, ThinkPad, E16, G3', total: 901248, status: 'Sales Order' },
  { ref: 'S01430', date: '2026-07-20 06:25:56', customer: 'Meko Fabrics (Pvt) Limited', fileNo: '', product: 'Lenovo LOQ 15IRX10', total: 452100, status: 'Quotation' },
  { ref: 'S01429', date: '2026-07-20 06:24:33', customer: 'SILICON ENTERPRISE SOLUTIONS (PRIVATE) LIMITED', fileNo: '', product: 'PowerEdge R760XS - Option 1', total: 4000000, status: 'Quotation' },
  { ref: 'S01428', date: '2026-07-20 06:22:42', customer: 'Premier Star Technology (Private) Limited', fileNo: '', product: 'FortiGate-120G & FortiGate-70G', total: 3324000, status: 'Quotation' },
  { ref: 'S01427', date: '2026-07-20 06:21:41', customer: 'MULTINET PAKISTAN (PVT.) LIMITED', fileNo: '', product: 'FortiGate-50G License', total: 98000, status: 'Quotation' },
  { ref: 'S01426', date: '2026-07-20 06:20:27', customer: 'Quick Techno', fileNo: '', product: 'HP DL38', total: 12586000, status: 'Quotation' },
  { ref: 'S01425', date: '2026-07-20 06:15:26', customer: 'LUCKY CORE INDUSTRIES LIMITED', fileNo: '', product: 'Trend Micro', total: 26445300, status: 'Quotation' },
  { ref: 'S01424', date: '2026-07-20 06:11:47', customer: 'SHAHEED ZULFIKAR ALI BHUTTO INSTITUTE OF SCIENCE AND TECHNOLOGY', fileNo: '', product: 'Viewsonic Projector', total: 377600, status: 'Quotation' },
  { ref: 'S01423', date: '2026-07-20 06:10:52', customer: 'AL MEHMOOD GROUP', fileNo: '', product: 'HP EliteBook 640 G11', total: 385000, status: 'Quotation' },
  { ref: 'S01422', date: '2026-07-20 06:10:07', customer: 'AL MEHMOOD GROUP', fileNo: '', product: 'PROBOOK 440 G11', total: 381150, status: 'Quotation' },
  { ref: 'S01421', date: '2026-07-20 06:09:07', customer: 'NISHAT HOTEL AND PROPERTIES LTD', fileNo: '', product: '480GB SSD SATA DELL', total: 252520, status: 'Quotation' },
  { ref: 'S01420', date: '2026-07-16 09:32:45', customer: 'AGA KHAN DEVELOPMENT NETWORK', fileNo: '', product: 'HP LED', total: 101480, status: 'Quotation' },
  { ref: 'S01405', date: '2026-07-14 09:25:41', customer: 'AL MEHMOOD GROUP', fileNo: '976 Green', product: 'HP PROBOOK 450 G10', total: 1542750, status: 'Sales Order' },
  { ref: 'S01419', date: '2026-07-15 12:13:46', customer: 'NATIONAL ENGINEERING AND SCIENTIFIC COMMISSION', fileNo: '975 Green', product: 'Blue - Ray USB & Disk', total: 82600, status: 'Sales Order' },
  { ref: 'S01418', date: '2026-07-15 12:11:18', customer: 'ENGRO CORPORATION LIMITED', fileNo: '974 Green', product: 'Laptop, ThinkPad, E16, G3', total: 901571, status: 'Sales Order' },
  { ref: 'S01417', date: '2026-07-15 12:08:30', customer: 'SHAHEED ZULFIKAR ALI BHUTTO INSTITUTE OF SCIENCE AND TECHNOLOGY', fileNo: '', product: 'Dell Desktop with LED', total: 1029600, status: 'Quotation' },
  { ref: 'S01416', date: '2026-07-15 12:05:30', customer: 'THE INSTITUTE OF CHARTERED ACCOUNTANTS OF PAKISTAN', fileNo: '', product: 'Power BI Pro', total: 124200, status: 'Quotation' },
  { ref: 'S01415', date: '2026-07-15 12:02:27', customer: 'INSTITUTE OF BUSINESS MANAGEMENT', fileNo: '', product: 'Microsoft License', total: 378194, status: 'Quotation' },
  { ref: 'S01414', date: '2026-07-15 07:44:38', customer: 'U&I Garments Pvt. Ltd.', fileNo: '', product: 'Lenovo V15 G5', total: 497200, status: 'Quotation' },
  { ref: 'S01413', date: '2026-07-15 07:41:19', customer: 'SILICON ENTERPRISE SOLUTIONS (PRIVATE) LIMITED', fileNo: '', product: 'Server R770', total: 17500000, status: 'Quotation' },
  { ref: 'S01412', date: '2026-07-15 07:40:10', customer: 'HP world', fileNo: '', product: 'PowerEdge R760XS - B2B', total: 35436776, status: 'Quotation' },
  { ref: 'S01411', date: '2026-07-15 07:38:32', customer: 'HP world', fileNo: '', product: 'PowerEdge R760XS - SNS', total: 11000000, status: 'Quotation' },
  { ref: 'S01409', date: '2026-07-15 07:34:53', customer: 'AMRELI STEELS LIMITED', fileNo: '', product: 'HP PROBOOK 440 G10', total: 385000, status: 'Quotation' },
  { ref: 'S01408', date: '2026-07-14 11:48:13', customer: 'MULTINET PAKISTAN (PVT.) LIMITED', fileNo: '', product: 'FG-50G Hardware plus 1 Year License', total: 320000, status: 'Quotation' },
  { ref: 'S01407', date: '2026-07-14 11:47:14', customer: 'MEEZAN BANK LIMITED', fileNo: '', product: 'HP Printer', total: 3492800, status: 'Quotation' },
  { ref: 'S01406', date: '2026-07-14 11:46:16', customer: 'InfoCentric Pty Ltd', fileNo: '', product: 'APC SMARTUPS 10kVA', total: 2250800, status: 'Quotation' },

  // Page 10
  { ref: 'S01404', date: '2026-07-14 09:24:25', customer: 'INFORMATION SYSTEMS ASSOCIATES LIMITED', fileNo: '973 Green', product: 'FortiGate-100F License', total: 408250, status: 'Sales Order' },
  { ref: 'S01403', date: '2026-07-14 09:22:14', customer: 'S.M.SOHAIL TRUST (SMST)', fileNo: '', product: '101F renewal', total: 4186000, status: 'Quotation' },
  { ref: 'S01402', date: '2026-07-14 09:20:45', customer: 'OOCL LOGISTICS PAKISTAN PVT. LIMITED', fileNo: '', product: 'Dell Pro 14 Premium XCTO', total: 1050896, status: 'Quotation' },
  { ref: 'S01401', date: '2026-07-14 09:19:13', customer: 'OOCL Pakistan (Private) Limited', fileNo: '', product: 'Dell Pro 14 Premium XCTO', total: 6305376, status: 'Quotation' },
  { ref: 'S01400', date: '2026-07-14 09:17:44', customer: 'PC HOUSE Islamabad', fileNo: '', product: 'PowerEdge R760XS -B2B', total: 31413090, status: 'Quotation' },
  { ref: 'S01399', date: '2026-07-14 09:16:46', customer: 'PC HOUSE Islamabad', fileNo: '', product: 'PowerEdge R760XS -SNS', total: 8000000, status: 'Quotation' },
  { ref: 'S01398', date: '2026-07-13 12:15:01', customer: 'AGA KHAN DEVELOPMENT NETWORK', fileNo: '', product: 'HP ProBook 440 G11', total: 9152000, status: 'Quotation' },
  { ref: 'S01397', date: '2026-07-13 12:13:48', customer: 'PAKO COMPUTERS', fileNo: '', product: 'Cisco Products', total: 518000, status: 'Quotation' },
  { ref: 'S01396', date: '2026-07-13 12:09:19', customer: 'KBK ELECTRONICS (PVT) LTD', fileNo: '', product: 'Cisco Products', total: 984200, status: 'Quotation' },
  { ref: 'S01395', date: '2026-07-13 12:05:30', customer: 'ESCAPE TECHNOLOGIES PRIVATE LIMITED', fileNo: '', product: 'Dell PowerEdge R750', total: 4800000, status: 'Quotation' },
  { ref: 'S01394', date: '2026-07-13 12:03:56', customer: 'INSTITUTE OF BUSINESS MANAGEMENT', fileNo: '', product: 'LENOVO THINKBOOK 14 G8', total: 1082400, status: 'Quotation' },
  { ref: 'S01393', date: '2026-07-13 12:02:01', customer: 'INSTITUTE OF BUSINESS MANAGEMENT', fileNo: '', product: 'DAHUA CABLE', total: 218300, status: 'Quotation' },
  { ref: 'S01392', date: '2026-07-13 11:58:10', customer: 'ENGRO CORPORATION LIMITED', fileNo: '972 Green', product: 'Laptop, ThinkPad, E16, G3', total: 2266880, status: 'Sales Order' },
  { ref: 'S01391', date: '2026-07-13 11:56:20', customer: 'ENGRO POLYMER & CHEMICALS LIMITED', fileNo: '971 Green', product: 'Laptop, HP Ominbook Ultra 14', total: 580800, status: 'Sales Order' },
  { ref: 'S01384', date: '2026-07-13 06:17:03', customer: 'Masood Textile Mills Limited', fileNo: '970 Green', product: 'DELL 14 PLUS 2 IN 1 CORE ULTRA 7', total: 375100, status: 'Sales Order' },
  { ref: 'S01390', date: '2026-07-13 06:29:53', customer: 'TIME & TUNE', fileNo: '969 Blue', product: 'DELL Server PowerEdge R770', total: 11564000, status: 'Sales Order' },
  { ref: 'S01389', date: '2026-07-13 06:26:19', customer: 'ENGRO POLYMER & CHEMICALS LIMITED', fileNo: '968 Green', product: 'LAPTOP, MACBOOK AIR, MacBook Air 13', total: 475002, status: 'Sales Order' },
  { ref: 'S01388', date: '2026-07-13 06:23:36', customer: 'U&I Garments Pvt. Ltd.', fileNo: '', product: 'Lenovo ThinkBook 16 G8', total: 431200, status: 'Quotation' },
  { ref: 'S01387', date: '2026-07-13 06:21:02', customer: 'DIVERSE ENGINEERING SOLUTIONS', fileNo: '', product: 'UPS', total: 3398400, status: 'Quotation' },
  { ref: 'S01386', date: '2026-07-13 06:19:15', customer: 'U&I Garments Pvt. Ltd.', fileNo: '', product: 'Lenovo NB', total: 248600, status: 'Quotation' },
  { ref: 'S01385', date: '2026-07-13 06:18:16', customer: 'MEEZAN BANK LIMITED', fileNo: '', product: 'Dell Pro Tower Essential QVT1260', total: 2178000, status: 'Quotation' },
  { ref: 'S01383', date: '2026-07-10 09:02:04', customer: 'GeekTech', fileNo: '967 Green', product: 'Dell PowerEdge R360', total: 1200000, status: 'Sales Order' },
  { ref: 'S01382', date: '2026-07-10 08:08:55', customer: 'U&I Garments Pvt. Ltd.', fileNo: '', product: 'Lenovo Desktop', total: 1749000, status: 'Quotation' },
  { ref: 'S01381', date: '2026-07-10 08:07:56', customer: 'PAKISTAN STOCK EXCHANGE LIMITED', fileNo: '', product: 'Lenovo ThinkPad E14 Gen 7', total: 467500, status: 'Quotation' },
  { ref: 'S01380', date: '2026-07-10 07:58:24', customer: 'TELCO INTEGRATORS (PVT.) LIMITED', fileNo: '', product: 'Dell PowerEdge R750', total: 9350000, status: 'Quotation' },
  { ref: 'S01379', date: '2026-07-10 07:57:24', customer: 'CYBER INTERNET SERVICES (PRIVATE) LIMITED', fileNo: '', product: 'BDCOM', total: 640150, status: 'Quotation' },
  { ref: 'S01378', date: '2026-07-10 06:24:32', customer: 'IT NETWORK', fileNo: '966 Blue', product: 'Dell PowerEdge R760xs', total: 8700000, status: 'Sales Order' },
  { ref: 'S01377', date: '2026-07-10 06:16:28', customer: 'ENGRO POWERGEN QADIRPUR LIMITED', fileNo: '965 Green', product: 'Laptop, ThinkPad, E16, G3', total: 453376, status: 'Sales Order' },
  { ref: 'S01376', date: '2026-07-09 12:35:40', customer: 'MEEZAN BANK LIMITED', fileNo: '', product: 'Lenovo Legion Pro 7i', total: 2145000, status: 'Quotation' },
  { ref: 'S01375', date: '2026-07-09 12:34:28', customer: 'U&I Garments Pvt. Ltd.', fileNo: '', product: 'Lenovo Desktop 1TB', total: 583000, status: 'Quotation' },
  { ref: 'S01374', date: '2026-07-09 10:40:49', customer: 'INFORMATION SYSTEMS ASSOCIATES LIMITED', fileNo: '', product: 'FortiGate 80F Renewal', total: 265000, status: 'Quotation' },
  { ref: 'S01373', date: '2026-07-09 10:39:30', customer: 'REDTONE TELECOMMUNICATIONS PAKISTAN (PVT.) LIMITED', fileNo: '', product: 'Subscription License for FortiGate-VM', total: 1896700, status: 'Quotation' },
  { ref: 'S01372', date: '2026-07-09 10:38:37', customer: 'U&I Garments Pvt. Ltd.', fileNo: '', product: 'Lenovo Desktop 2TB', total: 3080000, status: 'Quotation' },
  { ref: 'S01371', date: '2026-07-09 10:37:42', customer: 'Aga Khan Foundation', fileNo: '', product: 'Lenovo LED', total: 50740, status: 'Quotation' },
  { ref: 'S01370', date: '2026-07-09 09:22:26', customer: 'TrueFix', fileNo: '', product: 'PowerEdge R760 - [ASPER760] With Gold', total: 10500000, status: 'Quotation' },
  { ref: 'S01369', date: '2026-07-09 09:19:38', customer: 'TrueFix', fileNo: '', product: 'PowerEdge R760 - [ASPER760] With Silver', total: 9500000, status: 'Quotation' },

  // Page 11
  { ref: 'S01368', date: '2026-07-09 09:17:43', customer: 'IT NETWORK', fileNo: '', product: 'HPE LTO-6 Ultrium 6.25TB Data Cartridge', total: 2880000, status: 'Quotation' },
  { ref: 'S01367', date: '2026-07-09 09:16:31', customer: 'INSTITUTE OF BUSINESS MANAGEMENT', fileNo: '', product: 'Laptop', total: 980100, status: 'Quotation' },
  { ref: 'S01366', date: '2026-07-09 09:15:49', customer: 'ENGRO FERTILIZERS LIMITED', fileNo: '', product: 'Apple - MacBook Air', total: 919600, status: 'Quotation' },
  { ref: 'S01333', date: '2026-07-06 09:54:01', customer: 'PAKO COMPUTERS', fileNo: '964 Blue', product: 'PowerEdge R760XS', total: 3000000, status: 'Sales Order' },
  { ref: 'S01365', date: '2026-07-08 12:14:33', customer: 'GADOON TEXTILE MILLS LIMITED', fileNo: '', product: 'SSD', total: 20650, status: 'Quotation' },
  { ref: 'S01364', date: '2026-07-08 11:39:30', customer: 'SYBRID (PRIVATE) LIMITED', fileNo: '', product: 'Refurbished Dell PowerEdge R740xd Rack Server', total: 1798320, status: 'Quotation' },
  { ref: 'S01363', date: '2026-07-08 11:23:27', customer: 'PC HOTEL LAHORE', fileNo: '', product: 'Intel 480 GB SSD', total: 800000, status: 'Quotation' },
  { ref: 'S01362', date: '2026-07-08 11:17:00', customer: 'TrueFix', fileNo: '', product: 'PowerEdge R760XS - [ASPER760XS]', total: 5200000, status: 'Quotation' },
  { ref: 'S01361', date: '2026-07-08 11:15:45', customer: 'U&I Garments Pvt. Ltd.', fileNo: '', product: 'Lenovo LED', total: 53100, status: 'Quotation' },
  { ref: 'S01360', date: '2026-07-08 10:07:17', customer: 'TELCO INTEGRATORS (PVT.) LIMITED', fileNo: '', product: 'FG-200F , FG-100F , FG-60F Bundles', total: 3675000, status: 'Quotation' },
  { ref: 'S01359', date: '2026-07-08 07:31:39', customer: 'NISHAT HOTEL AND PROPERTIES LTD', fileNo: '', product: 'RAM', total: 219834, status: 'Quotation' },
  { ref: 'S01358', date: '2026-07-08 07:30:26', customer: 'RAPIDEV (PRIVATE) LIMITED', fileNo: '', product: 'FortiGate 60F Firewall', total: 172500, status: 'Quotation' },
  { ref: 'S01357', date: '2026-07-08 07:15:33', customer: 'ADVANTAGE TECHNOLOGIES', fileNo: '', product: 'Dell PowerEdge R770', total: 29500000, status: 'Quotation' },
  { ref: 'S01356', date: '2026-07-08 07:14:02', customer: 'CYBER INTERNET SERVICES (PRIVATE) LIMITED', fileNo: '', product: 'Dell 7.8TB SSD SAS', total: 3540000, status: 'Quotation' },
  { ref: 'S01355', date: '2026-07-08 06:53:13', customer: 'KBK ELECTRONICS (PVT) LTD', fileNo: '', product: 'UPS & HDD', total: 651650, status: 'Quotation' },
  { ref: 'S01354', date: '2026-07-07 12:47:57', customer: 'REDTONE TELECOMMUNICATIONS PAKISTAN (PVT.) LIMITED', fileNo: '', product: 'FG100F Renewal', total: 425000, status: 'Quotation' },
  { ref: 'S01353', date: '2026-07-07 12:46:26', customer: 'U&I Garments Pvt. Ltd.', fileNo: '', product: 'Lenovo ThinkCentre M70t Gen 5', total: 586300, status: 'Quotation' },
  { ref: 'S01352', date: '2026-07-07 12:45:36', customer: 'AGA KHAN DEVELOPMENT NETWORK', fileNo: '', product: 'Dell Pro 16 PC16250', total: 423500, status: 'Quotation' },
  { ref: 'S01351', date: '2026-07-07 12:43:44', customer: 'REDTONE TELECOMMUNICATIONS PAKISTAN (PVT.) LIMITED', fileNo: '', product: 'Fortigate 40F', total: 392000, status: 'Quotation' },
  { ref: 'S01350', date: '2026-07-07 12:42:16', customer: 'AQL TECH SOLUTIONS PRIVATE LIMITED', fileNo: '', product: 'Dell Laptop', total: 2956360, status: 'Quotation' },
  { ref: 'S01349', date: '2026-07-07 12:41:13', customer: 'PAK DATACOM LIMITED', fileNo: '', product: 'UPS', total: 7693600, status: 'Quotation' },
  { ref: 'S01348', date: '2026-07-07 12:39:45', customer: 'PAK DATACOM LIMITED', fileNo: '', product: 'UPS', total: 9131480, status: 'Quotation' },
  { ref: 'S01347', date: '2026-07-07 12:38:37', customer: 'PAK DATACOM LIMITED', fileNo: '', product: 'Mikrotik', total: 91450, status: 'Quotation' },
  { ref: 'S01346', date: '2026-07-07 12:38:00', customer: 'AQL TECH SOLUTIONS PRIVATE LIMITED', fileNo: '', product: 'HP Laptop', total: 1844370, status: 'Quotation' },
  { ref: 'S01345', date: '2026-07-07 07:41:28', customer: 'MEEZAN BANK LIMITED', fileNo: '', product: 'Dell Pro Tower Essential QVT1260', total: 2002000, status: 'Quotation' },
  { ref: 'S01344', date: '2026-07-07 07:39:51', customer: 'IMTIAZ GROUP (PRIVATE) LIMITED', fileNo: '', product: 'Power BI Pro | 1 Year', total: 113344, status: 'Quotation' },
  { ref: 'S01343', date: '2026-07-07 07:29:06', customer: 'ENGRO CORPORATION LIMITED', fileNo: '962 Green', product: 'Laptop, ThinkPad, E16, G3', total: 8160768, status: 'Sales Order' },
  { ref: 'S01342', date: '2026-07-07 05:37:25', customer: 'OOCL Pakistan (Private) Limited', fileNo: '960 Green', product: 'HP LaserJet 220V Maintenance Kit', total: 168410, status: 'Sales Order' },
  { ref: 'S01324', date: '2026-07-03 11:48:58', customer: 'IT NETWORK', fileNo: '958 Blue', product: 'Synlogy Diskstation', total: 235000, status: 'Sales Order' },
  { ref: 'S01341', date: '2026-07-07 05:36:29', customer: 'TELCO INTEGRATORS (PVT.) LIMITED', fileNo: '', product: 'Dell PowerEdge R750', total: 10000000, status: 'Quotation' },
  { ref: 'S01339', date: '2026-07-07 05:34:32', customer: 'INDUS HOSPITAL & HEALTH NETWORK', fileNo: '', product: 'Grandstream', total: 65000, status: 'Quotation' },
  { ref: 'S01338', date: '2026-07-07 05:33:32', customer: 'HRA SWITCHGEAR ( PVT ) LTD', fileNo: '', product: 'EliteBook 850', total: 206690, status: 'Quotation' },
  { ref: 'S01337', date: '2026-07-07 05:32:27', customer: 'HRA SWITCHGEAR ( PVT ) LTD', fileNo: '', product: 'EliteBook 850 Without SSD', total: 151250, status: 'Quotation' },
  { ref: 'S01336', date: '2026-07-07 05:30:35', customer: 'COMPSI PVT LTD', fileNo: '', product: 'Dell PowerEdge R760xs Server', total: 22000000, status: 'Quotation' },
  { ref: 'S01335', date: '2026-07-07 05:27:49', customer: 'KBK ELECTRONICS (PVT) LTD', fileNo: '', product: 'Dell PowerEdge R760xs Server', total: 22000000, status: 'Quotation' },
  { ref: 'S01334', date: '2026-07-06 09:55:56', customer: 'Bureau Veritas Pakistan Private Limited', fileNo: '', product: 'Dell Pro 14 Plus (PB14250) XCTO Base', total: 577500, status: 'Quotation' },
  { ref: 'S01332', date: '2026-07-06 09:49:12', customer: 'HP world', fileNo: '', product: 'PowerEdge R760XS', total: 9000000, status: 'Quotation' },

  // Page 12
  { ref: 'S01331', date: '2026-07-06 09:42:01', customer: 'SEENQAAF INDUSTRIAL CO.', fileNo: '', product: 'Dell PowerEdge R760xs 2U', total: 3186000, status: 'Quotation' },
  { ref: 'S01330', date: '2026-07-06 09:40:11', customer: 'SEENQAAF INDUSTRIAL CO.', fileNo: '', product: 'Dell PowerEdge R660xs 1U', total: 3186000, status: 'Quotation' },
  { ref: 'S01329', date: '2026-07-06 09:38:42', customer: 'LIAQUAT NATIONAL HOSPITAL', fileNo: '', product: 'Dell EMC Unity 300 Storage', total: 6354325, status: 'Quotation' },
  { ref: 'S01327', date: '2026-07-06 09:33:37', customer: 'LUCKY CORE INDUSTRIES LIMITED', fileNo: '', product: 'Trend Micro renewal 2026-2027', total: 15629040, status: 'Quotation' },
  { ref: 'S01326', date: '2026-07-06 09:30:59', customer: 'SYBRID (PRIVATE) LIMITED', fileNo: '', product: 'Synology DiskStation', total: 7161420, status: 'Quotation' },
  { ref: 'S01325', date: '2026-07-06 09:28:44', customer: 'Gas & Oil Pakistan Ltd', fileNo: '', product: 'FortiGate firewall renewal July 2026', total: 461970, status: 'Quotation' },
  { ref: 'S01323', date: '2026-07-03 11:32:27', customer: "GERRY'S DNATA PVT. LTD.", fileNo: '', product: 'Dell PowerEdge R760xs Rack Server', total: 11800000, status: 'Quotation' },
  { ref: 'S01321', date: '2026-07-03 11:12:27', customer: 'Dunya TV', fileNo: '', product: 'Laptops', total: 2069210, status: 'Quotation' },
  { ref: 'S01320', date: '2026-07-03 11:10:59', customer: "GERRY'S DNATA PVT. LTD.", fileNo: '', product: 'LENOVO LEGION LED 34 R34W-30 CURVED', total: 165200, status: 'Quotation' },
  { ref: 'S01319', date: '2026-07-03 09:41:11', customer: 'CNERGYICO PK LIMITED', fileNo: '957 Green', product: 'HP LAPTOP 450G10 INTEL COR I7 1355U', total: 2063600, status: 'Sales Order' },
  { ref: 'S01318', date: '2026-07-03 08:08:55', customer: 'Quick Techno', fileNo: '', product: 'FortiGate-101F 3 Year License Renewal', total: 4100000, status: 'Quotation' },
  { ref: 'S01317', date: '2026-07-03 07:29:13', customer: 'MCB INVESTMENT MANAGEMENT LIMITED', fileNo: '', product: 'Dell Laptop', total: 375100, status: 'Quotation' },
  { ref: 'S01316', date: '2026-07-03 07:28:00', customer: 'Premier Star Technology (Private) Limited', fileNo: '', product: 'FortiGate-100F', total: 1068000, status: 'Quotation' },
  { ref: 'S01315', date: '2026-07-03 07:27:04', customer: 'TELCO INTEGRATORS (PVT.) LIMITED', fileNo: '', product: 'ThinkPad T16 Gen 7', total: 682000, status: 'Quotation' },
  { ref: 'S01314', date: '2026-07-03 07:25:34', customer: 'INSTITUTE OF BUSINESS MANAGEMENT', fileNo: '', product: 'Toner', total: 344029, status: 'Quotation' },
  { ref: 'S01313', date: '2026-07-03 07:24:33', customer: 'INFORMATION SYSTEMS ASSOCIATES LIMITED', fileNo: '', product: 'Dell PowerEdge R760 Server.', total: 9000000, status: 'Quotation' },
  { ref: 'S01312', date: '2026-07-03 07:20:22', customer: 'Bureau Veritas Pakistan Private Limited', fileNo: '', product: 'Dell Pro 14 Plus (PB14250) XCTO Base 32GB DDR5', total: 806960, status: 'Quotation' },
  { ref: 'S01311', date: '2026-07-03 07:18:42', customer: 'Bureau Veritas Pakistan Private Limited', fileNo: '', product: 'Dell Pro 14 Plus (PB14250) XCTO Base 16 GB DDR5', total: 28120400, status: 'Quotation' },
  { ref: 'S01310', date: '2026-07-02 12:54:10', customer: 'THE INSTITUTE OF CHARTERED ACCOUNTANTS OF PAKISTAN', fileNo: '', product: 'Toner', total: 110330, status: 'Quotation' },
  { ref: 'S01309', date: '2026-07-02 12:25:48', customer: 'HRA SWITCHGEAR ( PVT ) LTD', fileNo: '', product: 'EliteBook 850', total: 183590, status: 'Quotation' },
  { ref: 'S01308', date: '2026-07-02 12:10:00', customer: 'FAUJI OIL TERMINAL & DISTRIBUTION COMPANY LTD.', fileNo: '', product: 'Renewal of trend micro licenses', total: 1337970, status: 'Quotation' },
  { ref: 'S01307', date: '2026-07-02 12:06:37', customer: 'Premier Star Technology (Private) Limited', fileNo: '', product: '80F Hardware & UTP License', total: 626750, status: 'Quotation' },
  { ref: 'S01306', date: '2026-07-02 10:56:54', customer: 'ENGRO FERTILIZERS LIMITED', fileNo: '956 Green', product: 'Laptop, ThinkPad, E16, G3', total: 3627008, status: 'Sales Order' },
  { ref: 'S01305', date: '2026-07-01 12:30:12', customer: 'CYBER INTERNET SERVICES (PRIVATE) LIMITED', fileNo: '', product: '601E Renewal', total: 16183720, status: 'Quotation' },
  { ref: 'S01304', date: '2026-07-01 11:46:24', customer: 'MEEZAN BANK LIMITED', fileNo: '', product: 'Legion Pro 5 16IAX10', total: 1166000, status: 'Quotation' },
  { ref: 'S01303', date: '2026-07-01 10:31:46', customer: 'BAKHTAWAR AMIN MEMORIAL TRUST HOSPITAL', fileNo: '', product: 'DAHUA Cameras', total: 34668, status: 'Quotation' },
  { ref: 'S01302', date: '2026-07-01 10:30:11', customer: "GERRY'S DNATA PVT. LTD.", fileNo: '', product: 'Laptop Repairing', total: 23600, status: 'Quotation' },
  { ref: 'S01301', date: '2026-07-01 10:29:04', customer: 'AIRBLUE LIMITED', fileNo: '', product: 'Lenovo Legion 5 16IRX9', total: 1232000, status: 'Quotation' }
];

async function importCompletePdf() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB Atlas...');

    await User.updateOne({ email: 'farhan@gmail.com' }, { $set: { position: 'Sales Representative', department: 'Sales' } });
    await User.updateOne({ email: 'kaleem@gmail.com' }, { $set: { position: 'Sales Representative', department: 'Sales' } });

    const farhan = await User.findOne({ email: 'farhan@gmail.com' });
    const kaleem = await User.findOne({ email: 'kaleem@gmail.com' });

    if (!farhan || !kaleem) {
      console.error('Farhan or Kaleem not found!');
      process.exit(1);
    }

    // 1. Clear out previous records everywhere
    await Quotation.deleteMany({});
    await CustomerPO.deleteMany({});
    await ProductFile.deleteMany({});
    await SalesOrder.deleteMany({});
    await DeliveryNote.deleteMany({});
    await Invoice.deleteMany({});
    await Payment.deleteMany({});
    await Lead.deleteMany({});
    await Deal.deleteMany({});
    await SalesTarget.deleteMany({});

    console.log(`Cleared previous collections. Total PDF records to import: ${RAW_PDF_ROWS.length}`);

    // Set Up Active Monthly Targets for Farhan and Kaleem
    await SalesTarget.create({
      employee: farhan._id,
      period: 'September 2026',
      periodType: 'Monthly',
      targetAmount: 50000000,
      achievedAmount: 0,
      status: 'Active',
      startDate: new Date('2026-09-01'),
      endDate: new Date('2026-09-30'),
      notes: 'Enterprise Expansion Quota'
    });

    await SalesTarget.create({
      employee: kaleem._id,
      period: 'September 2026',
      periodType: 'Monthly',
      targetAmount: 50000000,
      achievedAmount: 0,
      status: 'Active',
      startDate: new Date('2026-09-01'),
      endDate: new Date('2026-09-30'),
      notes: 'Regional Expansion Quota'
    });

    let farhanAchieved = 0;
    let kaleemAchieved = 0;

    const leadsToInsert = [];
    const dealsToInsert = [];
    const quotationsToInsert = [];
    const customerPOsToInsert = [];
    const productFilesToInsert = [];
    const salesOrdersToInsert = [];
    const deliveryNotesToInsert = [];
    const invoicesToInsert = [];

    // Process all rows: Add complete PDF data into Farhan
    for (let i = 0; i < RAW_PDF_ROWS.length; i++) {
      const row = RAW_PDF_ROWS[i];
      const user = farhan;
      const salesPersonName = 'Farhan';

      const rowDate = new Date(row.date);
      const isSalesOrder = row.status === 'Sales Order';

      const leadId = new mongoose.Types.ObjectId();
      const quoId = new mongoose.Types.ObjectId();
      const cpoId = new mongoose.Types.ObjectId();
      const soId = new mongoose.Types.ObjectId();
      const dnId = new mongoose.Types.ObjectId();
      const invId = new mongoose.Types.ObjectId();

      const poNum = `PO-${row.ref.replace('S', '')}`;
      let fileColor = 'Blue';
      let fileNum = '';
      if (row.fileNo) {
        if (row.fileNo.toLowerCase().includes('green')) fileColor = 'Green';
        fileNum = row.fileNo.split(' ')[0] || row.fileNo;
      }

      // 1. Lead
      leadsToInsert.push({
        _id: leadId,
        name: row.customer,
        company: row.customer,
        contactPerson: 'Procurement Dept',
        email: `info@${row.customer.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 15)}.pk`,
        phone: '+92 300 ' + String(1000000 + i),
        status: isSalesOrder ? 'Converted' : 'Qualified',
        value: row.total,
        source: 'Direct',
        requirements: row.product,
        notes: `Extracted from reference file ${row.ref}`,
        assignedTo: user._id,
        createdBy: user._id,
        createdAt: rowDate,
        updatedAt: rowDate
      });

      // 2. Deal
      if (isSalesOrder) {
        dealsToInsert.push({
          title: `${row.customer} - ${row.product}`,
          clientName: row.customer,
          value: row.total,
          stage: 'Won',
          leadId: leadId,
          assignedTo: user._id,
          createdBy: user._id,
          createdAt: rowDate,
          updatedAt: rowDate
        });
      }

      // 3. Quotation
      quotationsToInsert.push({
        _id: quoId,
        quotationNumber: row.ref,
        orderReference: row.ref,
        creationDate: rowDate,
        clientName: row.customer,
        salePerson: salesPersonName,
        fileNo: row.fileNo || '',
        fileType: fileColor,
        productSummary: row.product,
        clientEmail: `info@${row.customer.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 15)}.pk`,
        clientPhone: '+92 300 ' + String(1000000 + i),
        totalAmount: row.total,
        netAmount: row.total,
        status: isSalesOrder ? 'Accepted' : 'Quotation',
        validUntil: new Date('2026-12-31'),
        items: [{ description: row.product, quantity: 1, unitPrice: row.total, total: row.total }],
        leadId: leadId,
        createdBy: user._id,
        createdAt: rowDate,
        updatedAt: rowDate
      });

      // 4. Sales Order & downstream workflow
      if (isSalesOrder) {
        farhanAchieved += row.total;

        customerPOsToInsert.push({
          _id: cpoId,
          poNumber: poNum,
          poDate: rowDate,
          customerName: row.customer,
          quotationId: quoId,
          quotationNumber: row.ref,
          amount: row.total,
          status: 'Received',
          createdBy: user._id,
          createdAt: rowDate,
          updatedAt: rowDate
        });

        productFilesToInsert.push({
          fileNumber: fileNum || `PF-${row.ref}`,
          fileType: fileColor,
          customerName: row.customer,
          quotationId: quoId,
          quotationNumber: row.ref,
          customerPOId: cpoId,
          customerPONumber: poNum,
          status: 'Active',
          products: [{ name: row.product, quantity: 1, unit: 'Units', description: row.product }],
          createdBy: user._id,
          createdAt: rowDate,
          updatedAt: rowDate
        });

        salesOrdersToInsert.push({
          _id: soId,
          orderNo: row.ref,
          orderReference: row.ref,
          clientName: row.customer,
          clientEmail: `info@${row.customer.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 15)}.pk`,
          clientPhone: '+92 300 ' + String(1000000 + i),
          salesPerson: user._id,
          salesPersonName: salesPersonName,
          fileNo: row.fileNo || fileNum,
          fileColor: fileColor,
          fileNumber: fileNum,
          productSummary: row.product,
          customerPORef: poNum,
          quotationRef: row.ref,
          orderDate: rowDate,
          deliveryDate: new Date(rowDate.getTime() + 7 * 24 * 60 * 60 * 1000),
          netAmount: row.total,
          totalAmount: row.total,
          currency: 'PKR',
          status: 'Confirmed',
          stockStatus: 'In Stock',
          items: [{ product: row.product, description: row.product, quantity: 1, unitPrice: row.total, total: row.total }],
          createdBy: user._id,
          createdAt: rowDate,
          updatedAt: rowDate
        });

        deliveryNotesToInsert.push({
          _id: dnId,
          deliveryNumber: `DN-${row.ref}`,
          deliveryNoteNumber: `DN-${row.ref}`,
          salesOrder: soId,
          salesOrderNumber: row.ref,
          clientName: row.customer,
          deliveryDate: new Date(rowDate.getTime() + 5 * 24 * 60 * 60 * 1000),
          status: 'Ready',
          items: [{ product: row.product, description: row.product, quantity: 1, demand: 1, availability: 'Available' }],
          carrier: 'Fortline Express Fleet',
          recipientName: 'Procurement Officer',
          createdBy: user._id,
          createdAt: rowDate,
          updatedAt: rowDate
        });

        invoicesToInsert.push({
          _id: invId,
          invoiceNumber: `INV-${row.ref}`,
          clientName: row.customer,
          customerEmail: `info@${row.customer.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 15)}.pk`,
          customerPhone: '+92 300 ' + String(1000000 + i),
          saleReference: row.ref,
          salesOrderId: soId,
          salesOrderNumber: row.ref,
          deliveryNoteId: dnId,
          deliveryNoteNumber: `DN-${row.ref}`,
          fileNumber: fileNum,
          fileType: fileColor,
          amount: row.total,
          subtotal: row.total,
          paidAmount: 0,
          outstandingAmount: row.total,
          status: 'Approved',
          issueDate: rowDate,
          dueDate: new Date(Date.now() + (20 + (i % 15)) * 24 * 60 * 60 * 1000),
          items: [{ description: row.product, quantity: 1, unitPrice: row.total, total: row.total }],
          createdBy: user._id,
          createdAt: rowDate,
          updatedAt: rowDate
        });
      }
    }

    console.log(`Inserting ${leadsToInsert.length} leads...`);
    await Lead.insertMany(leadsToInsert);
    console.log(`Inserting ${dealsToInsert.length} deals...`);
    await Deal.insertMany(dealsToInsert);
    console.log(`Inserting ${quotationsToInsert.length} quotations...`);
    await Quotation.insertMany(quotationsToInsert);
    console.log(`Inserting ${customerPOsToInsert.length} customer POs...`);
    await CustomerPO.insertMany(customerPOsToInsert);
    console.log(`Inserting ${productFilesToInsert.length} product files...`);
    await ProductFile.insertMany(productFilesToInsert);
    console.log(`Inserting ${salesOrdersToInsert.length} sales orders...`);
    await SalesOrder.insertMany(salesOrdersToInsert);
    console.log(`Inserting ${deliveryNotesToInsert.length} delivery notes...`);
    await DeliveryNote.insertMany(deliveryNotesToInsert);
    console.log(`Inserting ${invoicesToInsert.length} invoices...`);
    await Invoice.insertMany(invoicesToInsert);

    // Update targets with real achieved numbers
    await SalesTarget.updateOne({ employee: farhan._id }, { $set: { achievedAmount: farhanAchieved } });
    await SalesTarget.updateOne({ employee: kaleem._id }, { $set: { achievedAmount: kaleemAchieved } });

    const totalQ = await Quotation.countDocuments();
    const totalSO = await SalesOrder.countDocuments();
    const farhanQ = await Quotation.countDocuments({ createdBy: farhan._id });
    const kaleemQ = await Quotation.countDocuments({ createdBy: kaleem._id });
    const farhanSO = await SalesOrder.countDocuments({ salesPerson: farhan._id });
    const kaleemSO = await SalesOrder.countDocuments({ salesPerson: kaleem._id });

    console.log(`\n🎉 PDF Import Complete!`);
    console.log(`Total Quotations: ${totalQ} (Farhan: ${farhanQ}, Kaleem: ${kaleemQ})`);
    console.log(`Total Sales Orders: ${totalSO} (Farhan: ${farhanSO}, Kaleem: ${kaleemSO})`);
    console.log(`Farhan Sales Achieved: Rs. ${farhanAchieved.toLocaleString()}`);
    console.log(`Kaleem Sales Achieved: Rs. ${kaleemAchieved.toLocaleString()}`);

    process.exit(0);
  } catch (err) {
    console.error('Import error:', err);
    process.exit(1);
  }
}

module.exports = RAW_PDF_ROWS;
if (require.main === module) {
  importCompletePdf();
}
