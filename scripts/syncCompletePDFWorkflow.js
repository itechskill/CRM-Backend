const mongoose = require('mongoose');
require('dotenv').config();

const SalesOrder = require('../models/SalesOrder');
const DeliveryNote = require('../models/DeliveryNote');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const ProductFile = require('../models/ProductFile');
const User = require('../models/User');

const RAW_DATA = [
  // Page 1
  { ref: 'S01723', qDate: '2026-09-04', oDate: '2026-09-07', customer: 'PAKISTAN SERVICES LIMITED', product: '512 GB SSD', file: '1016 Green', total: 147500, delivery: 'Not Delivered', invoice: 'To Invoice', invNo: '', payment: 'NO' },
  { ref: 'S01717', qDate: '2026-09-04', oDate: '2026-09-04', customer: 'ENGRO POLYMER & CHEMICALS LIMITED', product: 'LAPTOP, ThinkBook,G8', file: '1015 Green', total: 16709000, delivery: 'Not Delivered', invoice: 'To Invoice', invNo: '', payment: 'NO' },
  { ref: 'S01709', qDate: '2026-09-04', oDate: '2026-09-04', customer: 'NATIONAL ENGINEERING AND SCIENTIFIC COMMISSION', product: 'Dell Poweredge R760', file: '1014 Blue', total: 18000000, delivery: 'Not Delivered', invoice: 'To Invoice', invNo: '', payment: 'NO' },
  { ref: 'S01700', qDate: '2026-09-02', oDate: '2026-09-02', customer: 'ENGRO FERTILIZERS LIMITED', product: 'SOFTWARE, LICENSE, CEBCDE-AA AA', file: '1013 Blue', total: 145463.5, delivery: 'Not Delivered', invoice: 'To Invoice', invNo: '', payment: 'NO' },
  { ref: 'S01675', qDate: '2026-08-28', oDate: '2026-09-02', customer: 'MEKOTEX (PRIVATE) LIMITED', product: 'FORTIGATE FIREWALL 101F LICENSE RENEWAL', file: '1012 Green', total: 509162.5, delivery: 'Not Delivered', invoice: 'To Invoice', invNo: '', payment: 'NO' },
  { ref: 'S01662', qDate: '2026-08-27', oDate: '2026-08-27', customer: 'NATIONAL PETROCARBON (PRIVATE) LIMITED', product: 'Fortigate 40F Bundle', file: '1011 Green', total: 194700, delivery: 'Not Delivered', invoice: 'To Invoice', invNo: '', payment: 'NO' },
  { ref: 'S01661', qDate: '2026-08-27', oDate: '2026-08-27', customer: 'ENGRO ENFRASHARE ( PRIVATE ) LIMITED', product: 'Laptop, ThinkPad, E16, G3', file: '1010 Green', total: 14961408, delivery: 'Not Delivered', invoice: 'To Invoice', invNo: '', payment: 'NO' },
  { ref: 'S01566', qDate: '2026-08-07', oDate: '2026-08-27', customer: 'INDUS HOSPITAL & HEALTH NETWORK', product: 'HP Scanner', file: '1009 Green', total: 193000, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1235', payment: 'NO' },
  { ref: 'S01641', qDate: '2026-08-21', oDate: '2026-08-25', customer: 'AIRBLUE LIMITED', product: 'Toten G3 Rack', file: '1008 Green', total: 175000, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1239', payment: 'NO' },
  { ref: 'S01653', qDate: '2026-08-25', oDate: '2026-08-25', customer: 'NATIONAL ENGINEERING AND SCIENTIFIC COMMISSION', product: 'External Blue Ray USB-Disc', file: '1007 Green', total: 359900, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1237', payment: 'NO' },
  { ref: 'S01652', qDate: '2026-08-21', oDate: '2026-08-25', customer: 'ENGRO POWERGEN THAR ( PVT. ) LIMITED', product: 'Laptop, ThinkPad, E16, G3', file: '1006 Green', total: 453376, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1234', payment: 'NO' },
  { ref: 'S01592', qDate: '2026-08-12', oDate: '2026-08-25', customer: 'AL MEHMOOD GROUP', product: 'PROBOOK 440 G11 ULTRA7 155U, 16GB', file: '1005 Green', total: 430650, delivery: 'Not Delivered', invoice: 'To Invoice', invNo: '', payment: 'NO' },
  { ref: 'S01651', qDate: '2026-08-21', oDate: '2026-08-25', customer: 'ENGRO FERTILIZERS LIMITED', product: 'Laptop, ThinkPad, E16, G3', file: '1004 Green', total: 453376, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1231', payment: 'NO' },
  { ref: 'S01649', qDate: '2026-08-18', oDate: '2026-08-25', customer: 'ENGRO CORPORATION LIMITED', product: 'Laptop, ThinkPad, E16, G3', file: '1001 Green', total: 2720256, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1233', payment: 'NO' },
  { ref: 'S01650', qDate: '2026-08-20', oDate: '2026-08-25', customer: 'COMPUTER CONCERN', product: 'BDCOM', file: '1003 Green', total: 214500, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INV1823', payment: 'NO' },
  { ref: 'S01340', qDate: '2026-07-06', oDate: '2026-08-25', customer: 'INDUS HOSPITAL & HEALTH NETWORK', product: 'HP Victus Notebook', file: '1002 Green', total: 914000, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1230', payment: 'NO' },
  { ref: 'S01607', qDate: '2026-08-17', oDate: '2026-08-17', customer: 'PAKISTAN SERVICES LIMITED', product: 'UPS 6KVA', file: '1000 Green', total: 560500, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1227', payment: 'NO' },
  { ref: 'S01543', qDate: '2026-08-05', oDate: '2026-08-17', customer: 'INDUS HOSPITAL & HEALTH NETWORK', product: 'HP Victus Notebook', file: '999 Green', total: 457000, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1228', payment: 'NO' },
  { ref: 'S01603', qDate: '2026-08-13', oDate: '2026-08-13', customer: 'CYBER INTERNET SERVICES (PRIVATE) LIMITED', product: '2TB NLSAS Server Hard Drive', file: '997 Green', total: 39530, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1226', payment: 'NO' },
  { ref: 'S01491', qDate: '2026-07-28', oDate: '2026-08-07', customer: 'THE INSTITUTE OF CHARTERED ACCOUNTANTS OF PAKISTAN', product: 'HP OMEN 16', file: '996 Green', total: 528000, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1224', payment: 'Partial Payment' },
  { ref: 'S01562', qDate: '2026-08-07', oDate: '2026-08-07', customer: 'ENGRO POWERGEN QADIRPUR LIMITED', product: 'Laptop, ThinkPad, E16, G3', file: '995 Green', total: 900598.6, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1219', payment: 'NO' },
  { ref: 'S01553', qDate: '2026-08-06', oDate: '2026-08-06', customer: 'WISE TECH SERVICES', product: 'Fortinet 40F', file: '994 Green', total: 122000, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1215', payment: 'Fully Paid' },
  { ref: 'S01544', qDate: '2026-08-05', oDate: '2026-08-06', customer: 'VTT PORT QASIM ( PRIVATE ) LIMITED', product: 'HPE MSA 900GB 12G', file: '993 Blue', total: 153400, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1238', payment: 'NO' },
  { ref: 'S01448', qDate: '2026-07-21', oDate: '2026-08-03', customer: 'PC HOTEL LAHORE', product: 'HP PROBOOK 450 G10', file: '992 Green', total: 891000, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1222', payment: 'NO' },
  { ref: 'S01410', qDate: '2026-07-15', oDate: '2026-08-01', customer: 'THE INSTITUTE OF CHARTERED ACCOUNTANTS OF PAKISTAN', product: 'FortiGate-100F 1 Year Unified Threat Protection', file: '991 Green', total: 454250, delivery: 'Not Delivered', invoice: 'To Invoice', invNo: '', payment: 'NO' },
  { ref: 'S01519', qDate: '2026-07-29', oDate: '2026-08-01', customer: 'InfoCentric Pty Ltd', product: 'Server R770', file: '990 Blue', total: 43424000, delivery: 'Not Delivered', invoice: 'To Invoice', invNo: '', payment: 'NO' },
  { ref: 'S01518', qDate: '2026-07-28', oDate: '2026-08-01', customer: 'ENGRO FERTILIZERS LIMITED', product: 'Galaxy Tablet', file: '989 Blue', total: 2094400, delivery: 'Not Delivered', invoice: 'To Invoice', invNo: '', payment: 'NO' },
  { ref: 'S01517', qDate: '2026-07-28', oDate: '2026-08-01', customer: 'ENGRO FERTILIZERS LIMITED', product: 'Printer & Scanner', file: '988 Green', total: 1150500, delivery: 'Not Delivered', invoice: 'To Invoice', invNo: '', payment: 'NO' },
  { ref: 'S01085', qDate: '2026-07-16', oDate: '2026-07-28', customer: 'NISHAT HOTEL AND PROPERTIES LTD', product: 'Dell PowerEdge R760xs 2U 8LFF', file: '986 Blue', total: 11682000, delivery: 'Not Delivered', invoice: 'To Invoice', invNo: '', payment: 'NO' },
  { ref: 'S01483', qDate: '2026-07-27', oDate: '2026-07-27', customer: 'PC HOTEL LAHORE', product: 'S1508D BDCOM', file: '985 Green', total: 19293, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1215', payment: 'NO' },
  { ref: 'S01469', qDate: '2026-07-23', oDate: '2026-07-23', customer: 'ENGRO POLYMER & CHEMICALS LIMITED', product: 'Laptop, ThinkPad, E16, G3', file: '984 Green', total: 9067520, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1215', payment: 'NO' },
  { ref: 'S01460', qDate: '2026-07-22', oDate: '2026-07-22', customer: 'ENGRO CORPORATION LIMITED', product: 'MAINTENANCE OR SUPPORT FEES', file: '983 Blue', total: 11772320, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1210', payment: 'Fully Paid' },
  { ref: 'S01459', qDate: '2026-07-21', oDate: '2026-07-22', customer: 'PAKISTAN SERVICES LIMITED', product: 'HPE 480GB SATA 6G 2.5-inch SSDs', file: '982 Blue', total: 944000, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1218', payment: 'NO' },
  { ref: 'S01443', qDate: '2026-07-21', oDate: '2026-07-21', customer: 'ENGRO VOPAK TERMINAL LIMITED', product: 'Laptop, ThinkPad, E16, G3', file: '981 Green', total: 453376, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1206', payment: 'NO' },
  { ref: 'S01322', qDate: '2026-07-03', oDate: '2026-07-20', customer: 'INDUS HOSPITAL & HEALTH NETWORK', product: 'HP Scanner', file: '980 Green', total: 114000, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1205', payment: 'Fully Paid' },
  { ref: 'S01432', qDate: '2026-07-20', oDate: '2026-07-20', customer: 'ENGRO ENERGY LIMITED', product: 'Laptop, ThinkPad, E16, G3,', file: '979 Green', total: 3173632, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1208', payment: 'Fully Paid' },
  { ref: 'S01431', qDate: '2026-07-20', oDate: '2026-07-20', customer: 'ENGRO POWERGEN THAR ( PVT. ) LIMITED', product: 'Laptop, ThinkPad, E16, G3,', file: '977 Green', total: 901247.6, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1207', payment: 'Fully Paid' },
  { ref: 'S01405', qDate: '2026-07-14', oDate: '2026-07-15', customer: 'AL MEHMOOD GROUP', product: 'HP PROBOOK 450 G10', file: '976 Green', total: 1542750, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1202', payment: 'NO' },
  { ref: 'S01419', qDate: '2026-07-15', oDate: '2026-07-15', customer: 'NATIONAL ENGINEERING AND SCIENTIFIC COMMISSION', product: 'Blue - Ray USB & Disk', file: '975 Green', total: 82600, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1212', payment: 'NO' },

  // Page 2
  { ref: 'S01418', qDate: '2026-07-15', oDate: '2026-07-15', customer: 'ENGRO CORPORATION LIMITED', product: 'Laptop, ThinkPad, E16, G3', file: '974 Green', total: 901571, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1200', payment: 'Fully Paid' },
  { ref: 'S01217', qDate: '2026-06-17', oDate: '2026-07-14', customer: 'NATIONAL ENGINEERING AND SCIENTIFIC COMMISSION', product: 'PowerEdge R760 With Gold Processor', file: '933 Blue', total: 32132760, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INV1824', payment: 'Fully Paid' },
  { ref: 'S01404', qDate: '2026-07-14', oDate: '2026-07-14', customer: 'INFORMATION SYSTEMS ASSOCIATES LIMITED', product: 'FortiGate-100F License', file: '973 Green', total: 408250, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'WWTS157', payment: 'Fully Paid' },
  { ref: 'S01392', qDate: '2026-07-13', oDate: '2026-07-13', customer: 'ENGRO CORPORATION LIMITED', product: 'Laptop, ThinkPad, E16, G3', file: '972 Green', total: 2266880, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1203', payment: 'Fully Paid' },
  { ref: 'S01391', qDate: '2026-07-13', oDate: '2026-07-13', customer: 'ENGRO POLYMER & CHEMICALS LIMITED', product: 'Laptop, HP Ominbook Ultra 14', file: '971 Green', total: 580800, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1198', payment: 'Fully Paid' },
  { ref: 'S01384', qDate: '2026-07-10', oDate: '2026-07-13', customer: 'Masood Textile Mills Limited', product: 'DELL 14 PLUS 2 IN 1 CORE ULTRA 7', file: '970 Green', total: 375100, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1201', payment: 'Fully Paid' },
  { ref: 'S01390', qDate: '2026-07-11', oDate: '2026-07-13', customer: 'TIME & TUNE', product: 'DELL Server PowerEdge R770', file: '969 Blue', total: 11564000, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1220', payment: 'Partial Payment' },
  { ref: 'S01389', qDate: '2026-07-10', oDate: '2026-07-13', customer: 'ENGRO POLYMER & CHEMICALS LIMITED', product: 'LAPTOP, MACBOOK AIR, MacBook Air 13', file: '968 Green', total: 475002, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1199', payment: 'Fully Paid' },
  { ref: 'S01383', qDate: '2026-07-10', oDate: '2026-07-10', customer: 'GeekTech', product: 'Dell PowerEdge R360', file: '967 Green', total: 1200000, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INV1818', payment: 'Fully Paid' },
  { ref: 'S01378', qDate: '2026-07-09', oDate: '2026-07-10', customer: 'IT NETWORK', product: 'Dell PowerEdge R760xs', file: '966 Blue', total: 8700000, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INV1820', payment: 'Partial Payment' },
  { ref: 'S01377', qDate: '2026-07-09', oDate: '2026-07-10', customer: 'ENGRO POWERGEN QADIRPUR LIMITED', product: 'Laptop, ThinkPad, E16, G3', file: '965 Green', total: 453376, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1196', payment: 'Fully Paid' },
  { ref: 'S01333', qDate: '2026-07-06', oDate: '2026-07-09', customer: 'PAKO COMPUTERS', product: 'PowerEdge R760XS', file: '964 Blue', total: 3000000, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INV1819', payment: 'NO' },
  { ref: 'S01150', qDate: '2026-06-09', oDate: '2026-07-07', customer: 'InfoCentric Pty Ltd', product: 'PowerEdge R760XS', file: '963 Blue', total: 19446073, delivery: 'Not Delivered', invoice: 'To Invoice', invNo: '', payment: 'NO' },
  { ref: 'S01343', qDate: '2026-07-07', oDate: '2026-07-07', customer: 'ENGRO CORPORATION LIMITED', product: 'Laptop, ThinkPad, E16, G3', file: '962 Green', total: 8160768, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1192', payment: 'Fully Paid' },
  { ref: 'S01342', qDate: '2026-07-06', oDate: '2026-07-07', customer: 'OOCL Pakistan (Private) Limited', product: 'HP LaserJet 220V Maintenance Kit', file: '960 Green', total: 168410, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1190', payment: 'Fully Paid' },
  { ref: 'S01324', qDate: '2026-07-03', oDate: '2026-07-07', customer: 'IT NETWORK', product: 'Synlogy Diskstation', file: '958 Blue', total: 235000, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INV1822', payment: 'Fully Paid' },
  { ref: 'S01319', qDate: '2026-07-03', oDate: '2026-07-03', customer: 'CNERGYICO PK LIMITED', product: 'HP LAPTOP 450G10 INTEL COR I7 1355U', file: '957 Green', total: 2063600, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1189', payment: 'Fully Paid' },
  { ref: 'S01306', qDate: '2026-07-02', oDate: '2026-07-02', customer: 'ENGRO FERTILIZERS LIMITED', product: 'Laptop, ThinkPad, E16, G3', file: '956 Green', total: 3627008, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1197', payment: 'Fully Paid' },
  { ref: 'S01224', qDate: '2026-06-17', oDate: '2026-07-02', customer: 'MEEZAN BANK LIMITED', product: 'Unbranded Desktop', file: '955 Green', total: 720500, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1193', payment: 'NO' },
  { ref: 'S00948', qDate: '2026-05-14', oDate: '2026-07-02', customer: 'NATIONAL ENGINEERING AND SCIENTIFIC COMMISSION', product: 'GOLD Server 2', file: '897 Blue', total: 10500000, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INV1811', payment: 'Fully Paid' },
  { ref: 'S01269', qDate: '2026-06-24', oDate: '2026-07-02', customer: 'INTERNATIONAL OFFICE PRODUCTS (PRIVATE) LIMITED', product: 'APC Smart-UPS 750VA', file: '954 Blue', total: 1349448, delivery: 'Not Delivered', invoice: 'To Invoice', invNo: '', payment: 'NO' },
  { ref: 'S01199', qDate: '2026-06-15', oDate: '2026-07-01', customer: 'MEEZAN BANK LIMITED', product: 'Unbranded Desktop', file: '953 Green', total: 759000, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1194', payment: 'NO' },
  { ref: 'S01284', qDate: '2026-06-29', oDate: '2026-06-30', customer: 'NISHAT HOTEL AND PROPERTIES LTD', product: 'Hp Laserjet Print Cartridge 93A', file: '952 Green', total: 94695, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1182', payment: 'Fully Paid' },
  { ref: 'S01290', qDate: '2026-06-30', oDate: '2026-06-30', customer: 'SHAHEEN AEROTRADERS', product: 'Lenovo Neo 50t i7', file: '951 Blue', total: 24893000, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1216', payment: 'Partial Payment' },
  { ref: 'S01289', qDate: '2026-06-29', oDate: '2026-06-30', customer: 'PC HOUSE', product: 'Dell Tower ECT1250', file: '950 Green', total: 13125000, delivery: 'Not Delivered', invoice: 'To Invoice', invNo: '', payment: 'NO' },
  { ref: 'S01240', qDate: '2026-06-19', oDate: '2026-06-30', customer: 'INTERNATIONAL OFFICE PRODUCTS (PRIVATE) LIMITED', product: 'PowerEdge R770', file: '949 Blue', total: 7670000, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1221', payment: 'Partial Payment' },
  { ref: 'S01286', qDate: '2026-06-29', oDate: '2026-06-30', customer: 'ENGRO CORPORATION LIMITED', product: 'HP OmniBook Ultra Flip Laptop 14', file: '948 Green', total: 580800, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1188', payment: 'NO' },
  { ref: 'S01282', qDate: '2026-06-29', oDate: '2026-06-30', customer: 'TIME & TUNE', product: 'PowerEdge R760xs', file: '947 Blue', total: 5546000, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1191', payment: 'Fully Paid' },
  { ref: 'S01074', qDate: '2026-06-01', oDate: '2026-06-30', customer: 'INDUS HOSPITAL & HEALTH NETWORK', product: 'Dell LED', file: '946 Green', total: 720000, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVF1180', payment: 'Fully Paid' },
  { ref: 'S01279', qDate: '2026-06-29', oDate: '2026-06-29', customer: 'ENGRO CORPORATION LIMITED', product: 'Laptop, ThinkPad, E16, G3', file: '945 Green', total: 453376, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1179', payment: 'NO' },
  { ref: 'S01203', qDate: '2026-06-15', oDate: '2026-06-23', customer: 'KARACHI TOOLS, DIES & MOULDS CENTRE', product: 'Dell Precision 5820 Work station', file: '944 Blue', total: 373750, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1209', payment: 'Fully Paid' },
  { ref: 'S01218', qDate: '2026-06-17', oDate: '2026-06-23', customer: 'NBP FUND MANAGEMENT LIMITED', product: 'Dell Tower ECT1250', file: '943 Green', total: 3605250, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1195', payment: 'Fully Paid' },
  { ref: 'S01246', qDate: '2026-06-16', oDate: '2026-06-22', customer: 'OOCL LOGISTICS PAKISTAN PVT. LIMITED', product: 'HP 80A Black Original', file: '941 Green', total: 112502, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1177', payment: 'Fully Paid' },
  { ref: 'S01096', qDate: '2026-06-11', oDate: '2026-06-22', customer: 'HARBIN ELECTRIC INTERNATIONAL COMPANY LIMITED', product: 'FortiGate-101F 1 Year Unified Threat Protection (UTP)', file: '942 Green', total: 621000, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1181', payment: 'Fully Paid' },
  { ref: 'S01208', qDate: '2026-06-16', oDate: '2026-06-19', customer: 'OOCL Pakistan (Private) Limited', product: '81 A toner', file: '940 Green', total: 249570.8, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1176', payment: 'NO' },
  { ref: 'S01238', qDate: '2026-06-19', oDate: '2026-06-19', customer: 'IT NETWORK', product: 'Dell PowerEdge R760xs', file: '938 Blue', total: 5000000, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INV1814', payment: 'Fully Paid' },
  { ref: 'S01235', qDate: '2026-06-18', oDate: '2026-06-18', customer: 'ENGRO CORPORATION LIMITED', product: 'Laptop, ThinkPad, E16, G3', file: '937 Green', total: 453376, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1178', payment: 'NO' },
  { ref: 'S01186', qDate: '2026-06-12', oDate: '2026-06-17', customer: 'DEFENCE RAYA GOLF & COUNTRY CLUB', product: 'UPS 720VA', file: '936 Green', total: 38399.56, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1173', payment: 'Fully Paid' },
  { ref: 'S01227', qDate: '2026-06-17', oDate: '2026-06-17', customer: 'ENGRO CORPORATION LIMITED', product: 'Laptop, ThinkPad, E16, G3', file: '934 Green', total: 4533760, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1175', payment: 'NO' },
  { ref: 'S01226', qDate: '2026-06-17', oDate: '2026-06-17', customer: 'PAKISTAN SERVICES LIMITED', product: 'SSD DRIVE 512 GB', file: '935 Green', total: 29500, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INVFL1172', payment: 'NO' },
  { ref: 'S01210', qDate: '2026-06-15', oDate: '2026-06-16', customer: 'COMPREHENSIVE INFO TECHNOLOGIES', product: 'Dell 2.4TB', file: '931 Green', total: 100000, delivery: 'Fully Delivered', invoice: 'Fully Invoiced', invNo: 'INV1808', payment: 'Fully Paid' }
];

async function syncPDFData() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB Atlas');

    // Find default sales user / manager
    const defaultUser = await User.findOne({ role: 'sales_manager' }) || await User.findOne({ role: 'admin' }) || await User.findOne({});
    if (!defaultUser) {
      console.error('No user found in database.');
      process.exit(1);
    }
    const userId = defaultUser._id;

    let soCount = 0;
    let dnCount = 0;
    let invCount = 0;
    let payCount = 0;
    let pfCount = 0;

    for (let index = 0; index < RAW_DATA.length; index++) {
      const row = RAW_DATA[index];

      // Parse file number and color
      const fileParts = (row.file || '').split(' ');
      const fileNum = fileParts[0] || '';
      let fileCol = fileParts[1] ? (fileParts[1].charAt(0).toUpperCase() + fileParts[1].slice(1).toLowerCase()) : '';
      if (fileCol !== 'Blue' && fileCol !== 'Green') {
        fileCol = fileCol === 'Yellow' ? 'Green' : '';
      }

      // 1. Upsert Product File if fileNum exists
      let productFileDoc = null;
      if (fileNum) {
        productFileDoc = await ProductFile.findOne({ fileNumber: fileNum });
        if (!productFileDoc) {
          productFileDoc = await ProductFile.create({
            fileNumber: fileNum,
            fileType: fileCol || 'Green',
            customerName: row.customer,
            salesOrderNumber: row.ref,
            products: [{ name: row.product, quantity: 1, unit: 'Units', description: row.product }],
            status: row.delivery === 'Fully Delivered' ? 'Completed' : 'Active',
            createdBy: userId
          });
          pfCount++;
        }
      }

      // Calculate Payment values
      let paymentStatus = 'Pending';
      let totalPaid = 0;
      if (row.payment === 'Fully Paid') {
        paymentStatus = 'Fully Paid';
        totalPaid = row.total;
      } else if (row.payment === 'Partial Payment') {
        paymentStatus = 'Partially Paid';
        totalPaid = Math.round(row.total * 0.5); // 50% partial advance
      }
      const outstandingBalance = row.total - totalPaid;

      // 2. Upsert Sales Order
      let soDoc = await SalesOrder.findOne({ orderReference: row.ref });
      const soData = {
        orderReference: row.ref,
        orderNumber: row.ref,
        creationDate: new Date(row.qDate),
        orderDate: new Date(row.oDate),
        clientName: row.customer,
        productSummary: row.product,
        fileNo: fileNum,
        fileType: fileCol,
        productFileId: productFileDoc ? productFileDoc._id : null,
        items: [{
          description: row.product,
          quantity: 1,
          unitPrice: row.total,
          total: row.total
        }],
        totalAmount: row.total,
        netAmount: row.total,
        discount: 0,
        tax: 0,
        status: 'Sales Order',
        deliveryStatus: row.delivery,
        invoiceStatus: row.invoice === 'Fully Invoiced' ? 'Fully Invoiced' : 'Not Invoiced',
        invoiceNumber: row.invNo || '',
        paymentStatus: paymentStatus,
        totalPaid: totalPaid,
        outstandingBalance: outstandingBalance,
        salesPerson: userId
      };

      if (!soDoc) {
        soDoc = await SalesOrder.create(soData);
        soCount++;
      } else {
        Object.assign(soDoc, soData);
        await soDoc.save();
      }

      // Link Product File with Sales Order if needed
      if (productFileDoc && !productFileDoc.salesOrderId) {
        productFileDoc.salesOrderId = soDoc._id;
        await productFileDoc.save();
      }

      // 3. Upsert Delivery Note
      const dnDeliveryNum = `WH/OUT/${String(index + 1).padStart(5, '0')}`;
      let dnDoc = await DeliveryNote.findOne({ sourceDocument: row.ref });
      const dnStatus = row.delivery === 'Fully Delivered' ? 'Done' : 'Ready';
      const dnData = {
        deliveryNumber: dnDeliveryNum,
        deliveryNoteNumber: dnDeliveryNum,
        salesOrder: soDoc._id,
        salesOrderNumber: row.ref,
        sourceDocument: row.ref,
        clientName: row.customer,
        deliveryAddress: `${row.customer} Headquarters, Pakistan`,
        operationType: 'Fortline: Delivery Orders',
        sourceLocation: 'WH/Stock',
        scheduledDate: new Date(row.oDate),
        deadline: new Date(row.oDate),
        productAvailability: 'Available',
        starred: false,
        items: [{
          product: row.product,
          description: row.product,
          demand: 1,
          quantity: row.delivery === 'Fully Delivered' ? 1 : 0,
          unit: 'Units',
          availability: 'Available',
          totalOrderedQty: 1
        }],
        status: dnStatus,
        deliveryDate: row.delivery === 'Fully Delivered' ? new Date(row.oDate) : null,
        createdBy: userId
      };

      if (!dnDoc) {
        dnDoc = await DeliveryNote.create(dnData);
        dnCount++;
      } else {
        Object.assign(dnDoc, dnData);
        await dnDoc.save();
      }

      // 4. Upsert Invoice if Invoiced
      let invDoc = null;
      if (row.invoice === 'Fully Invoiced' && row.invNo) {
        const invStatus = row.payment === 'Fully Paid' ? 'Paid' : (row.payment === 'Partial Payment' ? 'Partially Paid' : 'Sent');
        const dueDate = new Date(row.oDate);
        dueDate.setDate(dueDate.getDate() + 30);

        invDoc = await Invoice.findOne({ invoiceNumber: row.invNo });
        const invData = {
          invoiceNumber: row.invNo,
          clientName: row.customer,
          salesOrderId: soDoc._id,
          salesOrderNumber: row.ref,
          deliveryNoteId: dnDoc._id,
          deliveryNoteNumber: dnDoc.deliveryNumber,
          fileNumber: fileNum,
          fileType: fileCol,
          items: [{
            description: row.product,
            quantity: 1,
            unitPrice: row.total,
            total: row.total
          }],
          subtotal: row.total,
          tax: 0,
          taxRate: 0,
          discount: 0,
          amount: row.total,
          paidAmount: totalPaid,
          outstandingAmount: outstandingBalance,
          status: invStatus,
          paymentTerms: 'Net 30',
          issueDate: new Date(row.oDate),
          dueDate: dueDate,
          createdBy: userId
        };

        if (!invDoc) {
          invDoc = await Invoice.create(invData);
          invCount++;
        } else {
          Object.assign(invDoc, invData);
          await invDoc.save();
        }
      }

      // 5. Upsert Customer Payment if paid/partial
      if (row.payment === 'Fully Paid' || row.payment === 'Partial Payment') {
        const payRef = `PAY-${row.ref}-${row.invNo || 'DIR'}`;
        let payDoc = await Payment.findOne({ paymentRefNumber: payRef });
        if (!payDoc) {
          await Payment.create({
            paymentRefNumber: payRef,
            customerName: row.customer,
            salesOrderId: soDoc._id,
            salesOrderNumber: row.ref,
            invoiceId: invDoc ? invDoc._id : null,
            invoiceNumber: row.invNo || '',
            paymentDate: new Date(row.oDate),
            amount: totalPaid,
            paymentType: row.payment === 'Fully Paid' ? 'Full' : 'Partial',
            paymentMethod: 'Bank Transfer',
            notes: `Auto-recorded payment for ${row.ref}`,
            createdBy: userId
          });
          payCount++;
        }
      }
    }

    console.log(`\n🎉 SYNC COMPLETED SUCCESSFULLY!`);
    console.log(`- Sales Orders Processed: ${RAW_DATA.length} (New created: ${soCount})`);
    console.log(`- Delivery Notes Processed: ${RAW_DATA.length} (New created: ${dnCount})`);
    console.log(`- Invoices Processed: ${invCount} newly created`);
    console.log(`- Payments Processed: ${payCount} newly created`);
    console.log(`- Product Files Processed: ${pfCount} newly created`);

    process.exit(0);
  } catch (error) {
    console.error('Error during data sync:', error);
    process.exit(1);
  }
}

syncPDFData();
