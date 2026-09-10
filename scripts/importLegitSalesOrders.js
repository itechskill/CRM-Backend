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

const LEGIT_SALES_ORDERS = [
  // Page 1
  { ref: 'S01723', quoDate: '2026-09-04 00:00:00', orderDate: '2026-09-07 11:58:50', customer: 'PAKISTAN SERVICES LIMITED', product: '512 GB SSD', fileNo: '1016 Green', total: 147500, deliveryStatus: 'Not Delivered', invoiceStatus: 'To Invoice', ledgerInvoice: '', payment: 'NO' },
  { ref: 'S01717', quoDate: '2026-09-04 00:00:00', orderDate: '2026-09-04 13:02:08', customer: 'ENGRO POLYMER & CHEMICALS LIMITED', product: 'LAPTOP, ThinkBook,G8', fileNo: '1015 Green', total: 16709000, deliveryStatus: 'Not Delivered', invoiceStatus: 'To Invoice', ledgerInvoice: '', payment: 'NO' },
  { ref: 'S01709', quoDate: '2026-09-04 00:00:00', orderDate: '2026-09-04 06:51:03', customer: 'NATIONAL ENGINEERING AND SCIENTIFIC COMMISSION', product: 'Dell Poweredge R760', fileNo: '1014 Blue', total: 18000000, deliveryStatus: 'Not Delivered', invoiceStatus: 'To Invoice', ledgerInvoice: '', payment: 'NO' },
  { ref: 'S01700', quoDate: '2026-09-02 00:00:00', orderDate: '2026-09-02 11:34:32', customer: 'ENGRO FERTILIZERS LIMITED', product: 'SOFTWARE, LICENSE, CEBCDE-AA AA', fileNo: '1013 Blue', total: 145464, deliveryStatus: 'Not Delivered', invoiceStatus: 'To Invoice', ledgerInvoice: '', payment: 'NO' },
  { ref: 'S01675', quoDate: '2026-08-28 00:00:00', orderDate: '2026-09-02 06:31:55', customer: 'MEKOTEX (PRIVATE) LIMITED', product: 'FORTIGATE FIREWALL 101F LICENSE RENEWAL', fileNo: '1012 Green', total: 509162, deliveryStatus: 'Not Delivered', invoiceStatus: 'To Invoice', ledgerInvoice: '', payment: 'NO' },
  { ref: 'S01662', quoDate: '2026-08-27 00:00:00', orderDate: '2026-08-27 12:13:28', customer: 'NATIONAL PETROCARBON (PRIVATE) LIMITED', product: 'Fortigate 40F Bundle', fileNo: '1011 Green', total: 194700, deliveryStatus: 'Not Delivered', invoiceStatus: 'To Invoice', ledgerInvoice: '', payment: 'NO' },
  { ref: 'S01661', quoDate: '2026-08-27 00:00:00', orderDate: '2026-08-27 11:08:43', customer: 'ENGRO ENFRASHARE ( PRIVATE ) LIMITED', product: 'Laptop, ThinkPad, E16, G3', fileNo: '1010 Green', total: 14961408, deliveryStatus: 'Not Delivered', invoiceStatus: 'To Invoice', ledgerInvoice: '', payment: 'NO' },
  { ref: 'S01566', quoDate: '2026-08-07 00:00:00', orderDate: '2026-08-27 08:19:44', customer: 'INDUS HOSPITAL & HEALTH NETWORK', product: 'HP Scanner', fileNo: '1009 Green', total: 193000, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1235', payment: 'NO' },
  { ref: 'S01641', quoDate: '2026-08-21 00:00:00', orderDate: '2026-08-25 11:51:45', customer: 'AIRBLUE LIMITED', product: 'Toten G3 Rack', fileNo: '1008 Green', total: 175000, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1239', payment: 'NO' },
  { ref: 'S01653', quoDate: '2026-08-25 00:00:00', orderDate: '2026-08-25 11:51:33', customer: 'NATIONAL ENGINEERING AND SCIENTIFIC COMMISSION', product: 'External Blue Ray USB-Disc', fileNo: '1007 Green', total: 359900, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1237', payment: 'NO' },
  { ref: 'S01652', quoDate: '2026-08-21 00:00:00', orderDate: '2026-08-25 08:08:17', customer: 'ENGRO POWERGEN THAR ( PVT. ) LIMITED', product: 'Laptop, ThinkPad, E16, G3', fileNo: '1006 Green', total: 453376, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1234', payment: 'NO' },
  { ref: 'S01592', quoDate: '2026-08-12 00:00:00', orderDate: '2026-08-25 08:06:35', customer: 'AL MEHMOOD GROUP', product: 'PROBOOK 440 G11 ULTRA7 155U, 16GB', fileNo: '1005 Green', total: 430650, deliveryStatus: 'Not Delivered', invoiceStatus: 'To Invoice', ledgerInvoice: '', payment: 'NO' },
  { ref: 'S01651', quoDate: '2026-08-21 00:00:00', orderDate: '2026-08-25 07:57:47', customer: 'ENGRO FERTILIZERS LIMITED', product: 'Laptop, ThinkPad, E16, G3', fileNo: '1004 Green', total: 453376, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1231', payment: 'NO' },
  { ref: 'S01649', quoDate: '2026-08-18 00:00:00', orderDate: '2026-08-25 07:47:05', customer: 'ENGRO CORPORATION LIMITED', product: 'Laptop, ThinkPad, E16, G3', fileNo: '1001 Green', total: 2720256, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1233', payment: 'NO' },
  { ref: 'S01650', quoDate: '2026-08-20 00:00:00', orderDate: '2026-08-25 07:43:13', customer: 'COMPUTER CONCERN', product: 'BDCOM', fileNo: '1003 Green', total: 214500, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INV1823', payment: 'NO' },
  { ref: 'S01340', quoDate: '2026-07-06 00:00:00', orderDate: '2026-08-25 07:37:22', customer: 'INDUS HOSPITAL & HEALTH NETWORK', product: 'HP Victus Notebook', fileNo: '1002 Green', total: 914000, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1230', payment: 'NO' },
  { ref: 'S01607', quoDate: '2026-08-17 00:00:00', orderDate: '2026-08-17 09:01:15', customer: 'PAKISTAN SERVICES LIMITED', product: 'UPS 6KVA', fileNo: '1000 Green', total: 560500, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1227', payment: 'NO' },
  { ref: 'S01543', quoDate: '2026-08-05 00:00:00', orderDate: '2026-08-17 06:48:27', customer: 'INDUS HOSPITAL & HEALTH NETWORK', product: 'HP Victus Notebook', fileNo: '999 Green', total: 457000, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1228', payment: 'NO' },
  { ref: 'S01603', quoDate: '2026-08-13 00:00:00', orderDate: '2026-08-13 12:08:15', customer: 'CYBER INTERNET SERVICES (PRIVATE) LIMITED', product: '2TB NLSAS Server Hard Drive', fileNo: '997 Green', total: 39530, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1226', payment: 'NO' },
  { ref: 'S01491', quoDate: '2026-07-28 00:00:00', orderDate: '2026-08-07 06:24:45', customer: 'THE INSTITUTE OF CHARTERED ACCOUNTANTS OF PAKISTAN', product: 'HP OMEN 16', fileNo: '996 Green', total: 528000, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1224', payment: 'Partial Payment' },
  { ref: 'S01562', quoDate: '2026-08-07 00:00:00', orderDate: '2026-08-07 06:24:40', customer: 'ENGRO POWERGEN QADIRPUR LIMITED', product: 'Laptop, ThinkPad, E16, G3', fileNo: '995 Green', total: 900599, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1219', payment: 'NO' },
  { ref: 'S01553', quoDate: '2026-08-06 00:00:00', orderDate: '2026-08-06 11:43:49', customer: 'WISE TECH SERVICES', product: 'Fortinet 40F', fileNo: '994 Green', total: 122000, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1215', payment: 'Fully Paid' },
  { ref: 'S01544', quoDate: '2026-08-05 00:00:00', orderDate: '2026-08-06 06:16:43', customer: 'VTT PORT QASIM ( PRIVATE ) LIMITED', product: 'HPE MSA 900GB 12G', fileNo: '993 Blue', total: 153400, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1238', payment: 'NO' },
  { ref: 'S01448', quoDate: '2026-07-21 00:00:00', orderDate: '2026-08-03 08:07:45', customer: 'PC HOTEL LAHORE', product: 'HP PROBOOK 450 G10', fileNo: '992 Green', total: 891000, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1222', payment: 'NO' },
  { ref: 'S01410', quoDate: '2026-07-15 00:00:00', orderDate: '2026-08-01 14:12:06', customer: 'THE INSTITUTE OF CHARTERED ACCOUNTANTS OF PAKISTAN', product: 'FortiGate-100F 1 Year Unified Threat Protection', fileNo: '991 Green', total: 454250, deliveryStatus: 'Not Delivered', invoiceStatus: 'To Invoice', ledgerInvoice: '', payment: 'NO' },
  { ref: 'S01519', quoDate: '2026-07-29 00:00:00', orderDate: '2026-08-01 14:10:49', customer: 'InfoCentric Pty Ltd', product: 'Server R770', fileNo: '990 Blue', total: 43424000, deliveryStatus: 'Not Delivered', invoiceStatus: 'To Invoice', ledgerInvoice: '', payment: 'NO' },
  { ref: 'S01518', quoDate: '2026-07-28 00:00:00', orderDate: '2026-08-01 14:07:04', customer: 'ENGRO FERTILIZERS LIMITED', product: 'Galaxy Tablet', fileNo: '989 Blue', total: 2094400, deliveryStatus: 'Not Delivered', invoiceStatus: 'To Invoice', ledgerInvoice: '', payment: 'NO' },
  { ref: 'S01517', quoDate: '2026-07-28 00:00:00', orderDate: '2026-08-01 14:03:50', customer: 'ENGRO FERTILIZERS LIMITED', product: 'Printer & Scanner', fileNo: '988 Green', total: 1150500, deliveryStatus: 'Not Delivered', invoiceStatus: 'To Invoice', ledgerInvoice: '', payment: 'NO' },
  { ref: 'S01085', quoDate: '2026-07-16 00:00:00', orderDate: '2026-07-28 07:45:35', customer: 'NISHAT HOTEL AND PROPERTIES LTD', product: 'Dell PowerEdge R760xs 2U 8LFF', fileNo: '986 Blue', total: 11682000, deliveryStatus: 'Not Delivered', invoiceStatus: 'To Invoice', ledgerInvoice: '', payment: 'NO' },
  { ref: 'S01483', quoDate: '2026-07-27 00:00:00', orderDate: '2026-07-27 07:06:15', customer: 'PC HOTEL LAHORE', product: 'S1508D BDCOM', fileNo: '985 Green', total: 19293, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1215', payment: 'NO' },
  { ref: 'S01469', quoDate: '2026-07-23 00:00:00', orderDate: '2026-07-23 10:42:14', customer: 'ENGRO POLYMER & CHEMICALS LIMITED', product: 'Laptop, ThinkPad, E16, G3', fileNo: '984 Green', total: 9067520, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1215', payment: 'NO' },
  { ref: 'S01460', quoDate: '2026-07-22 00:00:00', orderDate: '2026-07-22 12:05:44', customer: 'ENGRO CORPORATION LIMITED', product: 'MAINTENANCE OR SUPPORT FEES', fileNo: '983 Blue', total: 11772320, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1210', payment: 'Fully Paid' },
  { ref: 'S01459', quoDate: '2026-07-21 00:00:00', orderDate: '2026-07-22 11:36:46', customer: 'PAKISTAN SERVICES LIMITED', product: 'HPE 480GB SATA 6G 2.5-inch SSDs', fileNo: '982 Blue', total: 944000, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1218', payment: 'NO' },
  { ref: 'S01443', quoDate: '2026-07-21 00:00:00', orderDate: '2026-07-21 08:01:41', customer: 'ENGRO VOPAK TERMINAL LIMITED', product: 'Laptop, ThinkPad, E16, G3', fileNo: '981 Green', total: 453376, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1206', payment: 'NO' },
  { ref: 'S01322', quoDate: '2026-07-03 00:00:00', orderDate: '2026-07-20 06:43:56', customer: 'INDUS HOSPITAL & HEALTH NETWORK', product: 'HP Scanner', fileNo: '980 Green', total: 114000, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1205', payment: 'Fully Paid' },
  { ref: 'S01432', quoDate: '2026-07-20 00:00:00', orderDate: '2026-07-20 06:43:02', customer: 'ENGRO ENERGY LIMITED', product: 'Laptop, ThinkPad, E16, G3,', fileNo: '979 Green', total: 3173632, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1208', payment: 'Fully Paid' },
  { ref: 'S01431', quoDate: '2026-07-20 00:00:00', orderDate: '2026-07-20 06:39:29', customer: 'ENGRO POWERGEN THAR ( PVT. ) LIMITED', product: 'Laptop, ThinkPad, E16, G3,', fileNo: '977 Green', total: 901248, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1207', payment: 'Fully Paid' },
  { ref: 'S01405', quoDate: '2026-07-14 00:00:00', orderDate: '2026-07-15 12:26:12', customer: 'AL MEHMOOD GROUP', product: 'HP PROBOOK 450 G10', fileNo: '976 Green', total: 1542750, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1202', payment: 'NO' },
  { ref: 'S01419', quoDate: '2026-07-15 00:00:00', orderDate: '2026-07-15 12:14:20', customer: 'NATIONAL ENGINEERING AND SCIENTIFIC COMMISSION', product: 'Blue - Ray USB & Disk', fileNo: '975 Green', total: 82600, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1212, 1213', payment: 'NO' },
  { ref: 'S01418', quoDate: '2026-07-15 00:00:00', orderDate: '2026-07-15 12:12:13', customer: 'ENGRO CORPORATION LIMITED', product: 'Laptop, ThinkPad, E16, G3', fileNo: '974 Green', total: 901571, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1200', payment: 'Fully Paid' },
  { ref: 'S01217', quoDate: '2026-06-17 00:00:00', orderDate: '2026-07-14 11:19:39', customer: 'NATIONAL ENGINEERING AND SCIENTIFIC COMMISSION', product: 'PowerEdge R760 With Gold Processor', fileNo: '933 Blue', total: 32132760, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INV1824', payment: 'Fully Paid' },

  // Page 2
  { ref: 'S01404', quoDate: '2026-07-14 00:00:00', orderDate: '2026-07-14 10:47:27', customer: 'INFORMATION SYSTEMS ASSOCIATES LIMITED', product: 'FortiGate-100F License', fileNo: '973 Green', total: 408250, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'WWTS157', payment: 'Fully Paid' },
  { ref: 'S01392', quoDate: '2026-07-13 00:00:00', orderDate: '2026-07-13 11:58:23', customer: 'ENGRO CORPORATION LIMITED', product: 'Laptop, ThinkPad, E16, G3', fileNo: '972 Green', total: 2266880, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1203', payment: 'Fully Paid' },
  { ref: 'S01391', quoDate: '2026-07-13 00:00:00', orderDate: '2026-07-13 11:56:47', customer: 'ENGRO POLYMER & CHEMICALS LIMITED', product: 'Laptop, HP Ominbook Ultra 14', fileNo: '971 Green', total: 580800, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1198', payment: 'Fully Paid' },
  { ref: 'S01384', quoDate: '2026-07-10 00:00:00', orderDate: '2026-07-13 06:33:15', customer: 'Masood Textile Mills Limited', product: 'DELL 14 PLUS 2 IN 1 CORE ULTRA 7', fileNo: '970 Green', total: 375100, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1201', payment: 'Fully Paid' },
  { ref: 'S01390', quoDate: '2026-07-11 00:00:00', orderDate: '2026-07-13 06:30:57', customer: 'TIME & TUNE', product: 'DELL Server PowerEdge R770', fileNo: '969 Blue', total: 11564000, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1220', payment: 'Partial Payment' },
  { ref: 'S01389', quoDate: '2026-07-10 00:00:00', orderDate: '2026-07-13 06:27:11', customer: 'ENGRO POLYMER & CHEMICALS LIMITED', product: 'LAPTOP, MACBOOK AIR, MacBook Air 13', fileNo: '968 Green', total: 475002, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1199', payment: 'Fully Paid' },
  { ref: 'S01383', quoDate: '2026-07-10 00:00:00', orderDate: '2026-07-10 09:57:02', customer: 'GeekTech', product: 'Dell PowerEdge R360', fileNo: '967 Green', total: 1200000, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INV1818', payment: 'Fully Paid' },
  { ref: 'S01378', quoDate: '2026-07-09 00:00:00', orderDate: '2026-07-10 06:25:13', customer: 'IT NETWORK', product: 'Dell PowerEdge R760xs', fileNo: '966 Blue', total: 8700000, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INV1820', payment: 'Partial Payment' },
  { ref: 'S01377', quoDate: '2026-07-09 00:00:00', orderDate: '2026-07-10 06:17:20', customer: 'ENGRO POWERGEN QADIRPUR LIMITED', product: 'Laptop, ThinkPad, E16, G3', fileNo: '965 Green', total: 453376, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1196', payment: 'Fully Paid' },
  { ref: 'S01333', quoDate: '2026-07-06 00:00:00', orderDate: '2026-07-09 07:56:33', customer: 'PAKO COMPUTERS', product: 'PowerEdge R760XS', fileNo: '964 Blue', total: 3000000, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INV1819', payment: 'NO' },
  { ref: 'S01150', quoDate: '2026-06-09 00:00:00', orderDate: '2026-07-07 11:12:02', customer: 'InfoCentric Pty Ltd', product: 'PowerEdge R760XS', fileNo: '963 Blue', total: 19446073, deliveryStatus: 'Not Delivered', invoiceStatus: 'To Invoice', ledgerInvoice: '', payment: 'NO' },
  { ref: 'S01343', quoDate: '2026-07-07 00:00:00', orderDate: '2026-07-07 07:31:39', customer: 'ENGRO CORPORATION LIMITED', product: 'Laptop, ThinkPad, E16, G3', fileNo: '962 Green', total: 8160768, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1192', payment: 'Fully Paid' },
  { ref: 'S01342', quoDate: '2026-07-06 00:00:00', orderDate: '2026-07-07 05:40:12', customer: 'OOCL Pakistan (Private) Limited', product: 'HP LaserJet 220V Maintenance Kit', fileNo: '960 Green', total: 168410, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1190', payment: 'Fully Paid' },
  { ref: 'S01324', quoDate: '2026-07-03 00:00:00', orderDate: '2026-07-07 05:40:03', customer: 'IT NETWORK', product: 'Synlogy Diskstation', fileNo: '958 Blue', total: 235000, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INV1822', payment: 'Fully Paid' },
  { ref: 'S01319', quoDate: '2026-07-03 00:00:00', orderDate: '2026-07-03 09:42:38', customer: 'CNERGYICO PK LIMITED', product: 'HP LAPTOP 450G10 INTEL COR I7 1355U', fileNo: '957 Green', total: 2063600, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1189', payment: 'Fully Paid' },
  { ref: 'S01306', quoDate: '2026-07-02 00:00:00', orderDate: '2026-07-02 10:57:09', customer: 'ENGRO FERTILIZERS LIMITED', product: 'Laptop, ThinkPad, E16, G3', fileNo: '956 Green', total: 3627008, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1197', payment: 'Fully Paid' },
  { ref: 'S01224', quoDate: '2026-06-17 00:00:00', orderDate: '2026-07-02 10:13:40', customer: 'MEEZAN BANK LIMITED', product: 'Unbranded Desktop', fileNo: '955 Green', total: 720500, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1193', payment: 'NO' },
  { ref: 'S00948', quoDate: '2026-05-14 00:00:00', orderDate: '2026-07-02 10:07:02', customer: 'NATIONAL ENGINEERING AND SCIENTIFIC COMMISSION', product: 'GOLD Server 2', fileNo: '897 Blue', total: 10500000, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INV1811, INV1815', payment: 'Fully Paid' },
  { ref: 'S01269', quoDate: '2026-06-24 00:00:00', orderDate: '2026-07-02 08:54:38', customer: 'INTERNATIONAL OFFICE PRODUCTS (PRIVATE) LIMITED', product: 'APC Smart-UPS 750VA', fileNo: '954 Blue', total: 1349448, deliveryStatus: 'Not Delivered', invoiceStatus: 'To Invoice', ledgerInvoice: '', payment: 'NO' },
  { ref: 'S01199', quoDate: '2026-06-15 00:00:00', orderDate: '2026-07-01 10:38:27', customer: 'MEEZAN BANK LIMITED', product: 'Unbranded Desktop', fileNo: '953 Green', total: 759000, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1194', payment: 'NO' },
  { ref: 'S01284', quoDate: '2026-06-29 00:00:00', orderDate: '2026-06-30 09:11:38', customer: 'NISHAT HOTEL AND PROPERTIES LTD', product: 'Hp Laserjet Print Cartridge 93A', fileNo: '952 Green', total: 94695, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1182', payment: 'Fully Paid' },
  { ref: 'S01290', quoDate: '2026-06-30 00:00:00', orderDate: '2026-06-30 09:10:42', customer: 'SHAHEEN AEROTRADERS', product: 'Lenovo Neo 50t i7', fileNo: '951 Blue', total: 24893000, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1216', payment: 'Partial Payment' },
  { ref: 'S01289', quoDate: '2026-06-29 00:00:00', orderDate: '2026-06-30 09:08:51', customer: 'PC HOUSE', product: 'Dell Tower ECT1250', fileNo: '950 Yellow', total: 13125000, deliveryStatus: 'Not Delivered', invoiceStatus: 'To Invoice', ledgerInvoice: '', payment: 'NO' },
  { ref: 'S01240', quoDate: '2026-06-19 00:00:00', orderDate: '2026-06-30 07:12:21', customer: 'INTERNATIONAL OFFICE PRODUCTS (PRIVATE) LIMITED', product: 'PowerEdge R770', fileNo: '949 Blue', total: 7670000, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1221', payment: 'Partial Payment' },
  { ref: 'S01286', quoDate: '2026-06-29 00:00:00', orderDate: '2026-06-30 07:11:25', customer: 'ENGRO CORPORATION LIMITED', product: 'HP OmniBook Ultra Flip Laptop 14', fileNo: '948 Green', total: 580800, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1188', payment: 'NO' },
  { ref: 'S01282', quoDate: '2026-06-29 00:00:00', orderDate: '2026-06-30 07:08:01', customer: 'TIME & TUNE', product: 'PowerEdge R760xs', fileNo: '947 Blue', total: 5546000, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1191', payment: 'Fully Paid' },
  { ref: 'S01074', quoDate: '2026-06-01 00:00:00', orderDate: '2026-06-30 07:07:04', customer: 'INDUS HOSPITAL & HEALTH NETWORK', product: 'Dell LED', fileNo: '946 Green', total: 720000, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVF1180', payment: 'Fully Paid' },
  { ref: 'S01279', quoDate: '2026-06-29 00:00:00', orderDate: '2026-06-29 06:18:59', customer: 'ENGRO CORPORATION LIMITED', product: 'Laptop, ThinkPad, E16, G3', fileNo: '945 Green', total: 453376, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1179', payment: 'NO' },
  { ref: 'S01203', quoDate: '2026-06-15 00:00:00', orderDate: '2026-06-23 11:34:13', customer: 'KARACHI TOOLS, DIES & MOULDS CENTRE', product: 'Dell Precision 5820 Work station', fileNo: '944 Blue', total: 373750, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1209', payment: 'Fully Paid' },
  { ref: 'S01218', quoDate: '2026-06-17 00:00:00', orderDate: '2026-06-23 06:37:52', customer: 'NBP FUND MANAGEMENT LIMITED', product: 'Dell Tower ECT1250', fileNo: '943 Green', total: 3605250, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1195', payment: 'Fully Paid' },
  { ref: 'S01246', quoDate: '2026-06-16 00:00:00', orderDate: '2026-06-22 10:26:42', customer: 'OOCL LOGISTICS PAKISTAN PVT. LIMITED', product: 'HP 80A Black Original', fileNo: '941 green', total: 112502, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1177', payment: 'Fully Paid' },
  { ref: 'S01096', quoDate: '2026-06-11 00:00:00', orderDate: '2026-06-22 08:08:20', customer: 'HARBIN ELECTRIC INTERNATIONAL COMPANY LIMITED', product: 'FortiGate-101F 1 Year Unified Threat Protection (UTP)', fileNo: '942 Green', total: 621000, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1181', payment: 'Fully Paid' },
  { ref: 'S01208', quoDate: '2026-06-16 00:00:00', orderDate: '2026-06-19 12:02:35', customer: 'OOCL Pakistan (Private) Limited', product: '81 A toner', fileNo: '940 green', total: 249571, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1176', payment: 'NO' },
  { ref: 'S01238', quoDate: '2026-06-19 00:00:00', orderDate: '2026-06-19 07:49:20', customer: 'IT NETWORK', product: 'Dell PowerEdge R760xs', fileNo: '938 Blue', total: 5000000, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INV1814', payment: 'Fully Paid' },
  { ref: 'S01235', quoDate: '2026-06-18 00:00:00', orderDate: '2026-06-18 11:42:27', customer: 'ENGRO CORPORATION LIMITED', product: 'Laptop, ThinkPad, E16, G3', fileNo: '937 Green', total: 453376, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1178', payment: 'NO' },
  { ref: 'S01186', quoDate: '2026-06-12 00:00:00', orderDate: '2026-06-17 12:02:25', customer: 'DEFENCE RAYA GOLF & COUNTRY CLUB', product: 'UPS 720VA', fileNo: '936 Green', total: 38399.6, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1173', payment: 'Fully Paid' },
  { ref: 'S01227', quoDate: '2026-06-17 00:00:00', orderDate: '2026-06-17 12:00:55', customer: 'ENGRO CORPORATION LIMITED', product: 'Laptop, ThinkPad, E16, G3', fileNo: '934 Green', total: 4533760, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1175', payment: 'NO' },
  { ref: 'S01226', quoDate: '2026-06-17 00:00:00', orderDate: '2026-06-17 11:54:48', customer: 'PAKISTAN SERVICES LIMITED', product: 'SSD DRIVE 512 GB', fileNo: '935 Green', total: 29500, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INVFL1172', payment: 'NO' },
  { ref: 'S01210', quoDate: '2026-06-15 00:00:00', orderDate: '2026-06-16 06:09:54', customer: 'COMPREHENSIVE INFO TECHNOLOGIES', product: 'Dell 2.4TB', fileNo: '931 Green', total: 100000, deliveryStatus: 'Fully Delivered', invoiceStatus: 'Fully Invoiced', ledgerInvoice: 'INV1808', payment: 'Fully Paid' }
];

async function importLegitOrders() {
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
    await Invoice.collection.dropIndex('invoiceNumber_1').catch(() => {});
    await Payment.deleteMany({});
    await Lead.deleteMany({});
    await Deal.deleteMany({});
    await SalesTarget.deleteMany({});

    console.log(`Cleared previous collections. Total Legit Sales Orders to import: ${LEGIT_SALES_ORDERS.length}`);

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

    let totalSalesAchieved = 0;
    let totalReceivables = 0;
    let totalPaid = 0;

    const leadsToInsert = [];
    const dealsToInsert = [];
    const quotationsToInsert = [];
    const customerPOsToInsert = [];
    const productFilesToInsert = [];
    const salesOrdersToInsert = [];
    const deliveryNotesToInsert = [];
    const invoicesToInsert = [];
    const paymentsToInsert = [];

    for (let i = 0; i < LEGIT_SALES_ORDERS.length; i++) {
      const row = LEGIT_SALES_ORDERS[i];
      const user = farhan;
      const salesPersonName = 'Farhan';

      const orderDate = new Date(row.orderDate);
      const quoDate = new Date(row.quoDate);

      const leadId = new mongoose.Types.ObjectId();
      const quoId = new mongoose.Types.ObjectId();
      const cpoId = new mongoose.Types.ObjectId();
      const soId = new mongoose.Types.ObjectId();
      const dnId = new mongoose.Types.ObjectId();
      const invId = new mongoose.Types.ObjectId();

      const poNum = `PO-${row.ref.replace('S', '')}`;
      let fileColor = 'Green';
      let fileNum = '';
      if (row.fileNo) {
        if (row.fileNo.toLowerCase().includes('blue')) fileColor = 'Blue';
        else if (row.fileNo.toLowerCase().includes('yellow')) fileColor = 'Yellow';
        else if (row.fileNo.toLowerCase().includes('green')) fileColor = 'Green';
        fileNum = row.fileNo.split(' ')[0] || row.fileNo;
      }

      const isFullyDelivered = (row.deliveryStatus === 'Fully Delivered');
      const isFullyInvoiced = (row.invoiceStatus === 'Fully Invoiced');
      const isFullyPaid = (row.payment === 'Fully Paid');
      const isPartialPaid = (row.payment === 'Partial Payment');

      let paidAmount = 0;
      let outstandingAmount = row.total;
      let paymentStatus = 'Unpaid';
      let invStatus = isFullyInvoiced ? 'Sent' : 'Draft';

      if (isFullyPaid) {
        paidAmount = row.total;
        outstandingAmount = 0;
        paymentStatus = 'Paid';
        invStatus = 'Paid';
      } else if (isPartialPaid) {
        paidAmount = Math.round(row.total / 2);
        outstandingAmount = row.total - paidAmount;
        paymentStatus = 'Partially Paid';
        invStatus = 'Partially Paid';
      } else {
        paidAmount = 0;
        outstandingAmount = row.total;
        paymentStatus = 'Unpaid';
        invStatus = isFullyInvoiced ? 'Sent' : 'Draft';
      }

      totalSalesAchieved += row.total;
      totalReceivables += outstandingAmount;
      totalPaid += paidAmount;

      const invoiceNumberToUse = row.ledgerInvoice || `INV-${row.ref}`;

      // 1. Lead
      leadsToInsert.push({
        _id: leadId,
        name: row.customer,
        company: row.customer,
        contactPerson: 'Procurement Dept',
        email: `info@${row.customer.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 15)}.pk`,
        phone: '+92 300 ' + String(1000000 + i),
        status: 'Converted',
        value: row.total,
        source: 'Direct',
        requirements: row.product,
        notes: `Extracted from reference file ${row.ref}`,
        assignedTo: user._id,
        createdBy: user._id,
        createdAt: quoDate,
        updatedAt: orderDate
      });

      // 2. Deal
      dealsToInsert.push({
        title: `${row.customer} - ${row.product}`,
        clientName: row.customer,
        value: row.total,
        stage: 'Won',
        leadId: leadId,
        assignedTo: user._id,
        createdBy: user._id,
        createdAt: quoDate,
        updatedAt: orderDate
      });

      // 3. Quotation
      quotationsToInsert.push({
        _id: quoId,
        quotationNumber: row.ref,
        orderReference: row.ref,
        creationDate: quoDate,
        clientName: row.customer,
        salePerson: salesPersonName,
        fileNo: row.fileNo || '',
        fileType: fileColor,
        productSummary: row.product,
        clientEmail: `info@${row.customer.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 15)}.pk`,
        clientPhone: '+92 300 ' + String(1000000 + i),
        totalAmount: row.total,
        netAmount: row.total,
        status: 'Accepted',
        validUntil: new Date('2026-12-31'),
        items: [{ description: row.product, quantity: 1, unitPrice: row.total, total: row.total }],
        leadId: leadId,
        createdBy: user._id,
        createdAt: quoDate,
        updatedAt: orderDate
      });

      // 4. Customer PO
      customerPOsToInsert.push({
        _id: cpoId,
        poNumber: poNum,
        poDate: quoDate,
        customerName: row.customer,
        quotationId: quoId,
        quotationNumber: row.ref,
        amount: row.total,
        status: 'Received',
        createdBy: user._id,
        createdAt: quoDate,
        updatedAt: orderDate
      });

      // 5. Product File
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
        createdAt: quoDate,
        updatedAt: orderDate
      });

      // 6. Sales Order
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
        orderDate: orderDate,
        deliveryDate: new Date(orderDate.getTime() + 7 * 24 * 60 * 60 * 1000),
        netAmount: row.total,
        totalAmount: row.total,
        currency: 'PKR',
        deliveryStatus: row.deliveryStatus,
        invoiceStatus: row.invoiceStatus,
        paymentStatus: paymentStatus,
        invoiceNumber: invoiceNumberToUse,
        status: isFullyDelivered ? 'Delivered' : 'Confirmed',
        stockStatus: 'In Stock',
        items: [{ product: row.product, description: row.product, quantity: 1, unitPrice: row.total, total: row.total }],
        createdBy: user._id,
        createdAt: orderDate,
        updatedAt: orderDate
      });

      // 7. Delivery Note
      deliveryNotesToInsert.push({
        _id: dnId,
        deliveryNumber: `DN-${row.ref}`,
        deliveryNoteNumber: `DN-${row.ref}`,
        salesOrder: soId,
        salesOrderNumber: row.ref,
        clientName: row.customer,
        deliveryDate: isFullyDelivered ? orderDate : new Date(orderDate.getTime() + 5 * 24 * 60 * 60 * 1000),
        status: isFullyDelivered ? 'Delivered' : 'Ready',
        items: [{ product: row.product, description: row.product, quantity: 1, demand: 1, availability: 'Available' }],
        carrier: 'Fortline Express Fleet',
        recipientName: 'Procurement Officer',
        createdBy: user._id,
        createdAt: orderDate,
        updatedAt: orderDate
      });

      // 8. Invoice
      invoicesToInsert.push({
        _id: invId,
        invoiceNumber: invoiceNumberToUse,
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
        paidAmount: paidAmount,
        outstandingAmount: outstandingAmount,
        status: invStatus,
        issueDate: orderDate,
        dueDate: new Date(orderDate.getTime() + 30 * 24 * 60 * 60 * 1000),
        items: [{ description: row.product, quantity: 1, unitPrice: row.total, total: row.total }],
        createdBy: user._id,
        createdAt: orderDate,
        updatedAt: orderDate
      });

      // 9. Payment Record (if paid or partially paid)
      if (paidAmount > 0) {
        paymentsToInsert.push({
          paymentRefNumber: `PAY-${row.ref}`,
          invoiceId: invId,
          invoiceNumber: invoiceNumberToUse,
          salesOrderId: soId,
          salesOrderNumber: row.ref,
          customerName: row.customer,
          amount: paidAmount,
          paymentType: isFullyPaid ? 'Full' : 'Partial',
          paymentMethod: 'Bank Transfer',
          notes: isFullyPaid ? `Full Payment received for ${row.customer} (${row.ref})` : `Partial Payment (50%) received for ${row.customer} (${row.ref})`,
          paymentDate: orderDate,
          createdBy: user._id,
          createdAt: orderDate,
          updatedAt: orderDate
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
    if (paymentsToInsert.length > 0) {
      console.log(`Inserting ${paymentsToInsert.length} payments...`);
      await Payment.insertMany(paymentsToInsert);
    }

    // Update target for Farhan
    await SalesTarget.updateOne({ employee: farhan._id }, { $set: { achievedAmount: totalSalesAchieved } });

    console.log(`\n🎉 Legit Sales Orders Data Import Complete!`);
    console.log(`Total Sales Orders: ${LEGIT_SALES_ORDERS.length}`);
    console.log(`Total Sales Achieved: Rs. ${totalSalesAchieved.toLocaleString()}`);
    console.log(`Total Paid Collected: Rs. ${totalPaid.toLocaleString()}`);
    console.log(`Total Receivables: Rs. ${totalReceivables.toLocaleString()}`);
    console.log(`Target Achieved %: ${Math.round((totalSalesAchieved / 50000000) * 100)}%`);

    process.exit(0);
  } catch (err) {
    console.error('Import error:', err);
    process.exit(1);
  }
}

importLegitOrders();
